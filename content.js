/* MathScope content script.
   Runs on Wikipedia pages. It never changes the article: it reads the TeX source
   that Wikipedia already ships with each formula, asks the panel (an extension
   page in an iframe, where the math engine lives) which formulas can be plotted,
   and outlines those so they can be clicked. */
(() => {
  if (window.__mathscopeLoaded) return;
  window.__mathscopeLoaded = true;

  const MAX_CANDIDATES = 400;
  const PANEL_URL = chrome.runtime.getURL('panel.html');
  const PANEL_ORIGIN = new URL(PANEL_URL).origin;

  /* ---- Wikipedia adapter: element -> TeX source ----
     Current Wikipedia markup (checked against live articles, November 2026):
       <span class="mwe-math-mathml-a11y">
         <math class="mwe-math-element …" typeof="mw:Extension/math"
               data-mw='{"name":"math","body":{"extsrc":"<TeX source>"}}'>…</math>
       </span>
       <mjx-container>…SVG drawn by MathJax, the part the reader sees…</mjx-container>
     Older markup kept the TeX in a MathML <annotation>, or in the alt text of a
     fallback <img>. Both are still read as a fallback. */
  function texFromDataMw(el) {
    const raw = el.getAttribute('data-mw');
    if (!raw) return '';
    try {
      const d = JSON.parse(raw);
      return d && d.body && typeof d.body.extsrc === 'string' ? d.body.extsrc.trim() : '';
    } catch (err) { return ''; }
  }
  function texOf(el) {
    const fromMw = texFromDataMw(el);
    if (fromMw) return fromMw;
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent.trim()) return ann.textContent.trim();
    const math = el.matches('math[alttext]') ? el : el.querySelector('math[alttext]');
    if (math && math.getAttribute('alttext')) return math.getAttribute('alttext').trim();
    const img = el.querySelector('img[alt]');
    if (img && img.alt) return img.alt.trim();
    return '';
  }
  /* Where to draw the outline. MathJax may replace its <mjx-container> when it
     typesets lazily, so in that layout the stable hidden span is marked and the
     visible sibling is styled and clicked through it. */
  function placement(el) {
    const wrap = el.parentElement;
    if (el.localName === 'math' && wrap && wrap.classList.contains('mwe-math-mathml-a11y')) {
      const next = wrap.nextElementSibling;
      if (next && next.localName === 'mjx-container') return { mark: wrap, mode: 'sibling' };
      const legacy = wrap.closest('span.mwe-math-element');
      if (legacy) return { mark: legacy, mode: 'direct' };
    }
    return { mark: el, mode: 'direct' };
  }

  function cleanTex(tex) {
    let t = tex.trim();
    const m = /^\{\\(?:displaystyle|textstyle|scriptstyle)\s*([\s\S]*)\}$/.exec(t);
    if (m) t = m[1].trim();
    /* Wikipedia formulas often end with sentence punctuation or spacing. */
    let prev;
    do {
      prev = t;
      t = t.replace(/(?:\\[,;:! ]|\\q?quad|~|\s)+$/, '').replace(/[.,;]$/, '');
    } while (t !== prev);
    return t;
  }

  function findEquations(root) {
    const sources = Array.from(root.querySelectorAll('math'));
    /* Image-only legacy formulas have no <math> at all. */
    root.querySelectorAll('span.mwe-math-element').forEach((sp) => { if (!sp.querySelector('math')) sources.push(sp); });
    const out = [];
    const seen = new Set();
    for (const el of sources) {
      const raw = texOf(el);
      if (!raw) continue;
      const tex = cleanTex(raw);
      /* Cheap pre-filter: only formulas that define something are worth parsing. */
      if (tex.length < 4 || tex.indexOf('=') < 0) continue;
      const place = placement(el);
      if (seen.has(place.mark)) continue;
      seen.add(place.mark);
      out.push({ id: out.length, mark: place.mark, mode: place.mode, raw, tex });
      if (out.length >= MAX_CANDIDATES) break;
    }
    return out;
  }

  const root = document.querySelector('#mw-content-text') || document.body;
  const equations = findEquations(root);
  if (!equations.length) return;

  /* ---- Panel dock ---- */
  const dock = document.createElement('div');
  dock.id = 'mathscope-dock';
  dock.hidden = true;
  const frame = document.createElement('iframe');
  frame.title = 'MathScope';
  frame.src = PANEL_URL;
  dock.appendChild(frame);
  document.documentElement.appendChild(dock);

  /* ---- Status badge: says the extension ran, even when nothing can be plotted ---- */
  const badge = document.createElement('div');
  badge.id = 'mathscope-badge';
  badge.textContent = 'MathScope: reading ' + equations.length + ' equations';
  document.documentElement.appendChild(badge);

  const giveUp = setTimeout(() => {
    badge.textContent = 'MathScope: the math engine did not answer. Reload the page.';
    badge.classList.add('mathscope-none');
  }, 20000);

  let selected = null;
  function post(msg) {
    if (frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ mathscope: true }, msg), PANEL_ORIGIN);
  }
  function openEquation(eq) {
    if (selected) { selected.mark.classList.remove('mathscope-selected'); if (selected.pill) selected.pill.classList.remove('mathscope-pill-on'); }
    selected = eq;
    eq.mark.classList.add('mathscope-selected');
    if (eq.pill) eq.pill.classList.add('mathscope-pill-on');
    dock.hidden = false;
    document.documentElement.classList.add('mathscope-open');
    post({ type: 'select', id: eq.id });
  }
  function closeDock() {
    dock.hidden = true;
    document.documentElement.classList.remove('mathscope-open');
    if (selected) { selected.mark.classList.remove('mathscope-selected'); if (selected.pill) selected.pill.classList.remove('mathscope-pill-on'); selected = null; }
  }
  function decorate(eq) {
    eq.mark.dataset.mathscopeId = String(eq.id);
    eq.mark.classList.add(eq.mode === 'sibling' ? 'mathscope-src' : 'mathscope-eq');
    if (eq.mode === 'direct') eq.mark.setAttribute('title', 'Plot with MathScope');
    /* A visible "Plot" pill: above a displayed equation, in front of an inline one. */
    const src = eq.mark.matches('math') ? eq.mark : eq.mark.querySelector('math');
    const shown = eq.mode === 'sibling' ? eq.mark.nextElementSibling : eq.mark;
    const block = (src && /mwe-math-element-block/.test(src.getAttribute('class') || ''))
      || (src && src.getAttribute('display') === 'block')
      || !!eq.mark.querySelector('.mwe-math-mathml-display, .mwe-math-fallback-image-display')
      || (shown && getComputedStyle(shown).display === 'block');
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mathscope-pill' + (block ? ' mathscope-pill-block' : '');
    pill.textContent = 'Plot';
    pill.dataset.mathscopeId = String(eq.id);
    pill.setAttribute('aria-label', 'Plot this equation with MathScope');
    eq.mark.parentNode.insertBefore(pill, eq.mark);
    eq.pill = pill;
  }
  /* One delegated listener, so it keeps working if MathJax swaps its nodes. */
  function equationAt(target) {
    if (!(target instanceof Element)) return null;
    let mark = target.closest('.mathscope-pill, .mathscope-eq');
    if (!mark) {
      const box = target.closest('mjx-container');
      const prev = box && box.previousElementSibling;
      if (prev && prev.classList.contains('mathscope-src')) mark = prev;
    }
    return mark ? equations[Number(mark.dataset.mathscopeId)] || null : null;
  }
  document.addEventListener('click', (ev) => {
    const eq = equationAt(ev.target);
    if (eq) { ev.preventDefault(); ev.stopPropagation(); openEquation(eq); }
  }, true);
  window.addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow || ev.origin !== PANEL_ORIGIN) return;
    const msg = ev.data;
    if (!msg || msg.mathscope !== true) return;
    if (msg.type === 'ready') {
      post({ type: 'classify', page: document.title, items: equations.map((e) => ({ id: e.id, tex: e.tex, raw: e.raw })) });
    } else if (msg.type === 'classified') {
      msg.plottable.forEach((id) => { try { if (equations[id]) decorate(equations[id]); } catch (err) { /* keep going */ } });
      clearTimeout(giveUp);
      badge.textContent = 'MathScope: ' + msg.plottable.length + ' of ' + equations.length + ' equations can plot';
      badge.classList.toggle('mathscope-none', msg.plottable.length === 0);
    } else if (msg.type === 'close') {
      closeDock();
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !dock.hidden) closeDock(); });
})();
