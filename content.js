/* MathScope content script.
   Finds the formulas on a page and reads the TeX source their renderer left in
   the DOM. It does not parse any math: the panel (an extension page in an
   iframe, where the math engine lives) says which formulas can be drawn, and
   those get a "Plot" pill.

   Adapters, one per rendering technology rather than per website:
     Wikipedia  <math typeof="mw:Extension/math" data-mw='{"body":{"extsrc":TeX}}'>,
                shown through a sibling <mjx-container>
     KaTeX      <span class="katex"> with <annotation encoding="application/x-tex">
                (ChatGPT, Claude and many blogs)
     MathJax 2  <script type="math/tex">TeX</script> next to the rendered frame
                (Stack Exchange and older sites)
     MathJax 3+ <mjx-container data-mathscope-tex="TeX">; the attribute is written
                by page-mathjax.js, which can ask MathJax for its sources
     MathML     <math alttext="TeX"> or a TeX <annotation> (arXiv HTML papers) */
(() => {
  if (window.__mathscopeLoaded) { if (typeof window.__mathscopeRescan === 'function') window.__mathscopeRescan(); return; }
  window.__mathscopeLoaded = true;

  const MAX_EQUATIONS = 2000;
  const PANEL_URL = chrome.runtime.getURL('panel.html');
  const PANEL_ORIGIN = new URL(PANEL_URL).origin;
  const IS_WIKI = /(^|\.)wikipedia\.org$|(^|\.)wikibooks\.org$|(^|\.)wikiversity\.org$/.test(location.hostname);

  /* ------------------------------------------------------------------ reading TeX */
  function cleanTex(tex) {
    let t = String(tex).replace(/\\(?:displaystyle|textstyle|scriptstyle)\b\s*/g, '').trim();
    if (t[0] === '{' && t[t.length - 1] === '}') {            // one pair of braces around everything
      let depth = 0, whole = true;
      for (let i = 0; i < t.length - 1; i++) { if (t[i] === '\\') { i++; continue; } if (t[i] === '{') depth++; else if (t[i] === '}') depth--; if (depth === 0) { whole = false; break; } }
      if (whole) t = t.slice(1, -1).trim();
    }
    let prev;
    do {
      prev = t;
      t = t.replace(/(?:\\[,;:! ]|\\q?quad|~|\s)+$/, '').replace(/[.,;]$/, '');
    } while (t !== prev);
    return t;
  }
  function texFromDataMw(el) {
    const raw = el.getAttribute('data-mw');
    if (!raw) return '';
    try {
      const d = JSON.parse(raw);
      return d && d.body && typeof d.body.extsrc === 'string' ? d.body.extsrc.trim() : '';
    } catch (err) { return ''; }
  }
  function texFromMathEl(el) {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent.trim()) return ann.textContent.trim();
    return (el.getAttribute('alttext') || '').trim();
  }

  /* Each adapter returns { source, mark, mode, block, tex } entries.
     source: the element that identifies the formula (used to avoid reading it twice)
     mark:   the element that carries MathScope's class and id
     mode:   'sibling' the visible box is the element after the mark (Wikipedia + MathJax)
             'insert'  a pill button is inserted before the mark (static pages)
             'pseudo'  the pill is a CSS ::before on the mark, so nothing is added to
                       the page's DOM. Safe on apps that re-render their own nodes. */
  const adapters = [
    function wikipedia(root, out) {
      root.querySelectorAll('math[typeof~="mw:Extension/math"]').forEach((el) => {
        const tex = texFromDataMw(el) || texFromMathEl(el);
        const wrap = el.parentElement;
        const block = /mwe-math-element-block/.test(el.getAttribute('class') || '') || el.getAttribute('display') === 'block';
        if (wrap && wrap.classList.contains('mwe-math-mathml-a11y')) {
          const next = wrap.nextElementSibling;
          if (next && next.localName === 'mjx-container') { out.push({ source: el, mark: wrap, mode: 'sibling', block, tex }); return; }
          const legacy = wrap.closest('span.mwe-math-element');
          if (legacy) { out.push({ source: el, mark: legacy, mode: 'insert', block, tex }); return; }
        }
        out.push({ source: el, mark: el, mode: 'insert', block, tex });
      });
      root.querySelectorAll('span.mwe-math-element').forEach((sp) => {          // older markup
        const math = sp.querySelector('math'), img = sp.querySelector('img[alt]');
        if (math && math.matches('[typeof~="mw:Extension/math"]')) return;
        const tex = (math && texFromMathEl(math)) || (img && img.alt) || '';
        out.push({ source: sp, mark: sp, mode: 'insert', block: !!sp.querySelector('.mwe-math-mathml-display, .mwe-math-fallback-image-display'), tex });
      });
    },
    function katex(root, out) {
      root.querySelectorAll('.katex').forEach((el) => {
        const ann = el.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
        if (!ann) return;
        out.push({ source: el, mark: el, mode: 'pseudo', block: !!el.closest('.katex-display'), tex: ann.textContent.trim() });
      });
    },
    function mathjax2(root, out) {
      root.querySelectorAll('script[type^="math/tex"]').forEach((sc) => {
        const frame = sc.id ? document.getElementById(sc.id + '-Frame') : null;
        if (!frame) return;
        const shown = frame.parentElement && /MathJax(_SVG|_CHTML)?_Display|MJXc-display/.test(frame.parentElement.className) ? frame.parentElement : frame;
        out.push({ source: sc, mark: shown, mode: 'pseudo', block: /mode\s*=\s*display/.test(sc.type), tex: sc.textContent.trim() });
      });
    },
    function mathjax3(root, out) {
      root.querySelectorAll('mjx-container[data-mathscope-tex]').forEach((el) => {
        const prev = el.previousElementSibling;
        if (prev && prev.classList.contains('mwe-math-mathml-a11y')) return;       // Wikipedia's, handled above
        out.push({ source: el, mark: el, mode: 'pseudo', block: el.hasAttribute('data-mathscope-display') || el.getAttribute('display') === 'true', tex: el.getAttribute('data-mathscope-tex') });
      });
    },
    function mathml(root, out) {
      root.querySelectorAll('math').forEach((el) => {
        if (el.closest('.katex, mjx-container, .MathJax, .MathJax_SVG, .MathJax_CHTML, .mwe-math-element, .mwe-math-mathml-a11y, mjx-assistive-mml')) return;
        const tex = texFromMathEl(el);
        if (tex) out.push({ source: el, mark: el, mode: 'insert', block: el.getAttribute('display') === 'block', tex });
      });
    }
  ];

  const equations = [];                 // { id, mark, mode, block, raw, tex, pill, label }
  const seen = new WeakSet();
  const root = (IS_WIKI && document.querySelector('#mw-content-text')) || document.body;

  function scan() {
    const found = [];
    for (const adapter of adapters) { try { adapter(root, found); } catch (err) { /* one renderer failing must not stop the rest */ } }
    const fresh = [];
    for (const f of found) {
      if (seen.has(f.source) || equations.length >= MAX_EQUATIONS) continue;
      seen.add(f.source);
      if (!f.tex) continue;
      const tex = cleanTex(f.tex);
      if (tex.length < 4 || tex.indexOf('=') < 0) continue;      // only formulas that define something are worth parsing
      const eq = { id: equations.length, mark: f.mark, mode: f.mode, block: f.block, raw: f.tex, tex, pill: null, label: null };
      equations.push(eq); fresh.push(eq);
    }
    return fresh;
  }

  /* ------------------------------------------------------------------ page chrome: dock, badge */
  let dock = null, frame = null, badge = null, ready = false, giveUp = null, plottableCount = 0;
  const queue = [];
  function ensureChrome() {
    if (dock) return;
    dock = document.createElement('div'); dock.id = 'mathscope-dock'; dock.hidden = true;
    frame = document.createElement('iframe'); frame.title = 'MathScope'; frame.src = PANEL_URL;
    dock.appendChild(frame);
    document.documentElement.appendChild(dock);
    if (IS_WIKI) document.documentElement.classList.add('mathscope-wiki');      // only there is the page narrowed to make room
    badge = document.createElement('div'); badge.id = 'mathscope-badge';
    document.documentElement.appendChild(badge);
    giveUp = setTimeout(() => {
      badge.textContent = 'MathScope: the math engine did not answer. Reload the page.';
      badge.classList.add('mathscope-none');
    }, 20000);
  }
  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ mathscope: true }, msg), PANEL_ORIGIN);
  }
  function sendFresh(fresh) {
    if (!fresh.length) return;
    ensureChrome();
    if (!plottableCount) badge.textContent = 'MathScope: reading ' + equations.length + ' equations';
    const msg = { type: 'classify', site: location.hostname, items: fresh.map((e) => ({ id: e.id, tex: e.tex, raw: e.raw })) };
    if (ready) post(msg); else queue.push(msg);
  }

  /* Count only formulas still on the page: chats replace their nodes as they re-render. */
  function updateBadge() {
    if (!badge) return;
    let total = 0, can = 0;
    for (const e of equations) { if (!e.mark.isConnected) continue; total++; if (e.label) can++; }
    plottableCount = can;
    badge.textContent = 'MathScope: ' + can + ' of ' + total + ' equations can plot';
    badge.classList.toggle('mathscope-none', can === 0);
  }

  /* ------------------------------------------------------------------ marking */
  let selected = null;
  function decorate(eq, label) {
    eq.label = label || 'Plot';
    const mark = eq.mark;
    if (!mark.isConnected) return;
    mark.dataset.mathscopeId = String(eq.id);
    if (eq.mode === 'sibling') { mark.classList.add('mathscope-src'); }
    else {
      mark.classList.add('mathscope-eq');
      mark.setAttribute('title', 'Open in MathScope');
    }
    if (eq.mode === 'pseudo') {
      mark.classList.add('mathscope-pseudo'); if (eq.block) mark.classList.add('mathscope-pseudo-block');
      mark.dataset.mathscopeLabel = eq.label;
      mark.setAttribute('role', 'button'); mark.setAttribute('tabindex', '0');
      return;
    }
    const anchor = eq.block && mark.localName === 'math' && mark.closest('table.ltx_equation, table.ltx_equationgroup') || mark;   // arXiv: above the whole equation row
    /* Wikipedia's MathJax can rebuild a formula's nodes after the page loads. The rebuilt
       formula is new to us, but its pill is already there: reuse it, never add a second. */
    const before = anchor.previousElementSibling;
    const pill = before && before.classList.contains('mathscope-pill') ? before : document.createElement('button');
    pill.type = 'button';
    pill.className = 'mathscope-pill' + (eq.block ? ' mathscope-pill-block' : '');
    pill.textContent = eq.label;
    pill.dataset.mathscopeId = String(eq.id);
    pill.setAttribute('aria-label', eq.label + ': open this equation in MathScope');
    if (pill !== before) anchor.parentNode.insertBefore(pill, anchor);
    eq.pill = pill;
  }
  function setSelected(eq) {
    if (selected) { selected.mark.classList.remove('mathscope-selected'); if (selected.pill) selected.pill.classList.remove('mathscope-pill-on'); }
    selected = eq;
    if (eq) { eq.mark.classList.add('mathscope-selected'); if (eq.pill) eq.pill.classList.add('mathscope-pill-on'); }
  }
  function openEquation(eq) {
    setSelected(eq);
    dock.hidden = false;
    document.documentElement.classList.add('mathscope-open');
    post({ type: 'select', id: eq.id });
  }
  function closeDock() {
    if (!dock) return;
    dock.hidden = true;
    document.documentElement.classList.remove('mathscope-open');
    setSelected(null);
  }
  /* One delegated listener, so it keeps working when a page swaps its own nodes. */
  function equationAt(target) {
    if (!(target instanceof Element)) return null;
    let mark = target.closest('.mathscope-pill, .mathscope-eq');
    if (!mark) {
      const box = target.closest('mjx-container');
      const prev = box && box.previousElementSibling;
      if (prev && prev.classList.contains('mathscope-src')) mark = prev;
    }
    return mark && mark.dataset.mathscopeId !== undefined ? equations[Number(mark.dataset.mathscopeId)] || null : null;
  }
  document.addEventListener('click', (ev) => {
    const eq = equationAt(ev.target);
    if (eq) { ev.preventDefault(); ev.stopPropagation(); openEquation(eq); }
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && dock && !dock.hidden) { closeDock(); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && ev.target.classList.contains('mathscope-pseudo')) {
      const eq = equationAt(ev.target);
      if (eq) { ev.preventDefault(); openEquation(eq); }
    }
  });

  window.addEventListener('message', (ev) => {
    if (!frame || ev.source !== frame.contentWindow || ev.origin !== PANEL_ORIGIN) return;
    const msg = ev.data;
    if (!msg || msg.mathscope !== true) return;
    if (msg.type === 'ready') {
      ready = true;
      queue.splice(0).forEach(post);
    } else if (msg.type === 'classified') {
      clearTimeout(giveUp);
      msg.plottable.forEach((p) => { try { if (equations[p.id]) decorate(equations[p.id], p.label); } catch (err) { /* keep going */ } });
      updateBadge();
    } else if (msg.type === 'close') {
      closeDock();
    }
  });

  /* ------------------------------------------------------------------ run, and keep up with pages that change */
  function rescan() {
    document.dispatchEvent(new CustomEvent('mathscope-rescan'));         // lets page-mathjax.js tag new MathJax output
    sendFresh(scan());
  }
  window.__mathscopeRescan = rescan;
  document.addEventListener('mathscope-mathjax', () => sendFresh(scan()));
  rescan();

  let timer = null;
  const ours = (n) => n.nodeType === 1 && (n.id === 'mathscope-dock' || n.id === 'mathscope-badge' || n.classList.contains('mathscope-pill'));
  new MutationObserver((records) => {
    let relevant = false;
    for (const r of records) {
      if (r.addedNodes.length && !Array.from(r.addedNodes).every(ours)) { relevant = true; break; }
    }
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(rescan, 800);                                     // wait for streaming or typesetting to settle
  }).observe(document.body, { childList: true, subtree: true });
})();
