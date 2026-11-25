/* MathScope panel controller.
   An extension page shown in an iframe beside the article. It receives the
   page's formulas from the content script, decides what each one can show,
   and drives the controls and the drawing. */
import { ComputeEngine } from './vendor/compute-engine/compute-engine.js';
import { splitParts, buildFunctionTable, analyseFormula, compileJson, compileComplex, scoped, defaultValue, locationLike,
  plainSym, symLatex, fmt, KIND_LABEL, DEFAULT_TERMS } from './math.js';
import { cssVar, drawCurve, drawMap, drawPath, View3D, surfaceScene, parametricSurfaceScene, spaceCurveScene, fieldScene } from './plots.js';

const $ = (s, r) => (r || document).querySelector(s);
const PARENT_ORIGIN = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
function send(msg) { window.parent.postMessage(Object.assign({ mathscope: true }, msg), PARENT_ORIGIN); }

function renderTex(el, src, display) {
  if (window.katex) {
    try {
      src = src.replace(/([A-Za-z0-9}])\s*\\exp/g, '$1\\,\\exp');
      el.innerHTML = window.katex.renderToString(src, { displayMode: !!display, throwOnError: false });
      el.querySelectorAll('annotation').forEach((n) => n.remove());
      el.classList.remove('tex-fallback');
      return;
    } catch (e) { /* fall through to plain source */ }
  }
  el.textContent = src;
  el.classList.add('tex-fallback');
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function setMsg(strong, rest) {
  const msg = $('#ms-msg'); msg.textContent = '';
  msg.appendChild(el('strong', '', strong)); msg.appendChild(document.createTextNode(' ' + rest));
}

/* ------------------------------------------------------------------ state */
const engine = new ComputeEngine();
const items = new Map();                 // id -> { tex, raw, analysis }
const st = { item: null, view: null, vi: 0, params: {}, axes: [], range: 6, mode: 'map', shade: 'curl', show3: 'field',
  showD: true, hover: null, geom: null, f: null, df: null, dKind: '', xs: [], series: [] };
const canvas = $('#ms-canvas'), plot = $('#ms-plot');
const view3d = new View3D(canvas, plot);

/* ------------------------------------------------------------------ messages */
window.addEventListener('message', (ev) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data;
  if (!msg || msg.mathscope !== true) return;
  if (msg.type === 'classify') classifyAll(msg.items || []);
  else if (msg.type === 'select') select(msg.id);
});
$('#ms-close').addEventListener('click', () => send({ type: 'close' }));

function classifyAll(list) {
  /* One synchronous pass, no timers: Chrome slows timers in an iframe that is not visible. */
  const partsAll = list.map((it) => { try { return splitParts(String(it.tex)); } catch (err) { return []; } });
  let table = null;
  try { table = buildFunctionTable(engine, partsAll); } catch (err) { table = null; }
  const plottable = [];
  list.forEach((it, i) => {
    let analysis = { views: [], parts: [] };
    try { analysis = analyseFormula(engine, String(it.tex), table, partsAll[i]); } catch (err) { /* leave empty */ }
    items.set(it.id, { id: it.id, tex: String(it.tex), raw: String(it.raw || it.tex), analysis });
    if (analysis.views.length) plottable.push({ id: it.id, label: KIND_LABEL[analysis.views[0].kind] || 'Plot' });
  });
  $('#ms-status').textContent = 'Wikipedia · ' + plottable.length + ' of ' + list.length + ' equations can plot';
  send({ type: 'classified', plottable });
}

/* ------------------------------------------------------------------ selecting */
function select(id) {
  const it = items.get(id);
  if (!it) return;
  st.item = it;
  $('#ms-src').textContent = it.raw;
  const views = it.analysis.views, box = $('#ms-views'), group = $('#ms-views-group');
  box.textContent = '';
  group.hidden = views.length < 2;
  views.forEach((v, i) => {
    const lab = el('label', 'chip');
    const inp = el('input'); inp.type = 'radio'; inp.name = 'ms-view'; inp.id = 'ms-view-' + i; inp.checked = i === 0;
    inp.addEventListener('change', () => showView(i));
    const sp = el('span');
    if (v.lhsLatex) renderTex(sp, v.lhsLatex, false); else sp.textContent = KIND_LABEL[v.kind];
    inp.setAttribute('aria-label', KIND_LABEL[v.kind] + (v.lhsLatex ? ' of ' + v.lhsLatex : ''));
    lab.appendChild(inp); lab.appendChild(sp); box.appendChild(lab);
  });
  if (!views.length) {
    renderTex($('#ms-eq-render'), it.tex, true);
    $('#ms-work').hidden = true; $('#ms-msg').hidden = false;
    const reason = (it.analysis.parts.find((p) => p.reason) || {}).reason || 'This is not written as a function';
    setMsg('MathScope cannot draw this one.', reason + '.');
    $('#ms-json').textContent = 'Not parsed.'; $('#ms-ir').textContent = JSON.stringify({ plottable: false }, null, 1);
    return;
  }
  showView(0);
}

function chipGroup(title, name, options, current, onPick, math) {
  const fs = el('fieldset', 'group'); fs.appendChild(el('legend', '', title));
  const box = el('div', 'chips');
  options.forEach((o, i) => {
    const value = typeof o === 'string' ? o : o.value, text = typeof o === 'string' ? o : o.text;
    const lab = el('label', 'chip' + (math ? '' : ' seg'));
    const inp = el('input'); inp.type = 'radio'; inp.name = name; inp.id = name + '-' + i; inp.value = value; inp.checked = value === current;
    inp.addEventListener('change', () => onPick(value));
    const sp = el('span');
    if (math) { renderTex(sp, symLatex(value), false); inp.setAttribute('aria-label', plainSym(value)); } else sp.textContent = text;
    lab.appendChild(inp); lab.appendChild(sp); box.appendChild(lab);
  });
  fs.appendChild(box);
  return fs;
}

const AXIS_TITLES = { curve: ['Horizontal axis'], complex: ['Horizontal axis'], surface: ['First axis', 'Second axis'], implicit: ['Horizontal axis', 'Vertical axis'],
  pcurve: ['Traced by'], psurface: ['Swept by', 'and by'] };
function initialAxes(v) {
  if (v.kind === 'curve' || v.kind === 'complex') return [v.variable];
  if (v.kind === 'surface' || v.kind === 'implicit') return [v.xVar, v.yVar];
  if (v.kind === 'pcurve' || v.kind === 'psurface') return v.params.slice();
  return v.coords.slice();
}

function showView(i) {
  const v = st.item.analysis.views[i];
  st.view = v; st.vi = i; st.hover = null; st.geom = null;
  renderTex($('#ms-eq-render'), v.tex || st.item.tex, true);
  $('#ms-msg').hidden = true; $('#ms-work').hidden = false;
  $('#ms-json').textContent = JSON.stringify(v.json);
  st.axes = initialAxes(v);
  st.params = { __terms: DEFAULT_TERMS };
  const shifts = v.rhsJson !== undefined && v.kind !== 'implicit' ? locationLike(v.rhsJson, st.axes) : new Set();
  v.unknowns.forEach((u) => { st.params[u] = v.kind === 'implicit' ? 1 : (shifts.has(u) ? 0 : defaultValue(u)); });
  st.mode = 'map'; st.shade = 'curl'; st.show3 = 'field'; st.range = 6;
  if (v.kind === 'curve' || v.kind === 'surface') settleDefaults(v);
  build();
}

/* If the guessed starting values leave nothing to draw (a symbol set to 0 sits in a
   denominator, say), start every parameter at 1 instead. */
function settleDefaults(v) {
  const f = compileJson(v.rhsJson, v.ctx), env = Object.assign({}, st.params);
  let ok = false;
  for (let k = 0; k < 40 && !ok; k++) {
    env[st.axes[0]] = -5.9 + 11.8 * ((k * 7) % 40) / 39; if (st.axes[1]) env[st.axes[1]] = -5.3 + 10.6 * ((k * 11) % 40) / 39;
    ok = isFinite(f(env));
  }
  if (!ok) v.unknowns.forEach((u) => { st.params[u] = 1; });
}

function paramNames() {
  const v = st.view;
  const free = v.unknowns.filter((u) => st.axes.indexOf(u) < 0);
  if (v.usesTerms) free.push('__terms');
  return free;
}

function build() {
  const v = st.view, kind = v.kind;
  view3d.active = false;
  /* axis pickers */
  const axes = $('#ms-axes'); axes.textContent = '';
  (AXIS_TITLES[kind] || []).forEach((title, k) => {
    axes.appendChild(chipGroup(title, 'ms-axis-' + k, v.unknowns, st.axes[k], (value) => {
      const other = st.axes.indexOf(value);
      if (other >= 0 && other !== k) st.axes[other] = st.axes[k];       // swap, so two axes never coincide
      st.axes[k] = value; st.hover = null; build();
    }, true));
  });
  /* sliders */
  const box = $('#ms-params'); box.textContent = '';
  const names = paramNames();
  names.forEach((u, i) => {
    const row = el('div', 'param');
    const name = el('label'); name.htmlFor = 'ms-p-' + i; renderTex(name, symLatex(u), false);
    const inp = el('input'); inp.type = 'range'; inp.id = 'ms-p-' + i;
    if (u === '__terms') { inp.min = 1; inp.max = 60; inp.step = 1; } else { inp.min = -5; inp.max = 5; inp.step = 0.05; }
    inp.value = st.params[u]; inp.setAttribute('aria-label', plainSym(u));
    const out = el('output', '', fmt(st.params[u])); out.htmlFor = inp.id;
    inp.addEventListener('input', () => { st.params[u] = parseFloat(inp.value); out.textContent = fmt(st.params[u]); prepare(false); render(); showIR(); });
    row.appendChild(name); row.appendChild(inp); row.appendChild(out); box.appendChild(row);
  });
  $('#ms-params-group').hidden = false;
  $('#ms-params-note').textContent = names.length
    ? 'Starting values are guesses. Every symbol not on an axis becomes a slider.' + (v.usesTerms ? ' “terms” sets how many terms of the infinite sum are added.' : '')
    : 'This equation has no other symbols, so there is nothing to adjust.';
  /* options */
  const opts = $('#ms-options'); opts.textContent = '';
  const spatial = ['curve', 'complex', 'surface', 'implicit', 'field2d', 'field3d'].indexOf(kind) >= 0;
  if (spatial) opts.appendChild(chipGroup('Range', 'ms-range', [{ value: '3', text: '±3' }, { value: '6', text: '±6' }, { value: '12', text: '±12' }], String(st.range), (val) => { st.range = parseFloat(val); st.hover = null; prepare(false); render(); }));
  if (kind === 'surface') opts.appendChild(chipGroup('View', 'ms-mode', [{ value: 'map', text: 'Map' }, { value: '3d', text: '3D' }], st.mode, (val) => { st.mode = val; st.hover = null; legend(); render(); }));
  if (kind === 'field2d') opts.appendChild(chipGroup('Colour shows', 'ms-shade', [{ value: 'curl', text: 'Curl' }, { value: 'div', text: 'Divergence' }, { value: 'strength', text: 'Strength' }], st.shade, (val) => { st.shade = val; render(); }));
  if (kind === 'field3d') opts.appendChild(chipGroup('Arrows show', 'ms-show3', [{ value: 'field', text: 'The field' }, { value: 'curl', text: 'Its curl' }], st.show3, (val) => { st.show3 = val; render(); }));
  $('#ms-deriv-box').hidden = kind !== 'curve';
  $('#ms-table-box').hidden = kind !== 'curve' && kind !== 'complex';
  prepare(true); legend(); render(); showIR();
}

/* ------------------------------------------------------------------ compile for the current view and axes */
function prepare(full) {
  const v = st.view, kind = v.kind;
  if (!full) return;
  st.f = null; st.df = null; st.dKind = '';
  if (kind === 'curve') {
    st.f = compileJson(v.rhsJson, v.ctx);
    const x = st.axes[0];
    let latex = '';
    if (!v.numericOnly) {
      try {
        const got = scoped(engine, () => { const d = engine.box(['D', v.rhsJson, x]).evaluate().simplify(); return { json: d.json, latex: d.latex }; });
        st.df = compileJson(got.json, v.ctx); latex = got.latex.replace(/\\mathrm\{(varphi|gamma)\}/g, '\\$1'); st.dKind = 'symbolic';
      } catch (err) { st.df = null; }
    }
    if (!st.df) {                                  // numeric slope where no formula is available
      const f = st.f;
      st.df = (env) => { const x0 = env[x], h = 1e-4 * Math.max(1, Math.abs(x0)); env[x] = x0 + h; const a = f(env); env[x] = x0 - h; const b = f(env); env[x] = x0; return (a - b) / (2 * h); };
      st.dKind = 'numeric';
    }
    const lhs = (v.fnTex && v.declared[0] === x) ? v.fnTex + "'(" + symLatex(x) + ')' : '\\frac{\\partial ' + (v.lhsLatex || 'y') + '}{\\partial ' + symLatex(x) + '}';
    $('#ms-deriv-cap').textContent = st.dKind === 'symbolic' ? 'Derivative, computed symbolically' : 'Derivative';
    if (st.dKind === 'symbolic') renderTex($('#ms-deriv'), lhs + ' = ' + latex, true);
    else $('#ms-deriv').textContent = 'Estimated numerically from the curve. This formula has a sum, an integral, cases or a function defined elsewhere, so no closed form is shown.';
  } else if (kind === 'complex') {
    st.f = compileComplex(v.rhsJson, v.ctx);
  } else if (kind === 'surface' || kind === 'implicit') {
    st.f = compileJson(v.rhsJson, v.ctx);
  }
}

function legend() {
  const v = st.view, box = $('#ms-legend'); box.textContent = '';
  const sw = (cls, text) => { const s = el('span', 'legend-item'); s.appendChild(el('span', 'swatch' + (cls ? ' ' + cls : ''))); s.appendChild(document.createTextNode(text)); return s; };
  const note = (text) => el('span', 'legend-item', text);
  if (v.kind === 'curve') {
    box.appendChild(sw('', 'Function'));
    const lab = el('label', 'legend-item'); lab.htmlFor = 'ms-show-d';
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'ms-show-d'; cb.checked = st.showD;
    cb.addEventListener('change', () => { st.showD = cb.checked; render(); });
    lab.appendChild(cb); lab.appendChild(el('span', 'swatch d')); lab.appendChild(document.createTextNode('Derivative'));
    box.appendChild(lab);
  } else if (v.kind === 'complex') { box.appendChild(sw('', 'Real part')); box.appendChild(sw('d', 'Imaginary part')); }
  else if (v.kind === 'surface') box.appendChild(note(st.mode === 'map' ? 'Colour shows the value. White lines join equal values.' : 'Height and colour show the value. Drag to rotate.'));
  else if (v.kind === 'implicit') box.appendChild(note('The line marks where the two sides are equal.'));
  else if (v.kind === 'field2d') box.appendChild(note('Arrows show direction. Longer means stronger.'));
  else if (v.kind === 'field3d') box.appendChild(note('Brighter, longer arrows are stronger. Drag to rotate.'));
  else if (v.kind === 'pcurve' && v.dims === 2) box.appendChild(note('The curve traced as ' + plainSym(st.axes[0]) + ' runs through its range.'));
  else box.appendChild(note('Drag to rotate.'));
  $('#ms-readout').textContent = hint();
}
function hint() {
  const k = st.view.kind;
  if (k === 'curve' || k === 'complex') return 'Hover the plot to read values.';
  if (k === 'surface' && st.mode === 'map') return 'Hover the map to read values.';
  if (k === 'field2d') return 'Hover the map to read the field.';
  if (k === 'implicit') return 'Move the sliders to reshape the curve.';
  return '';
}

function paramRange(name, other) {
  if (name === 'theta') return other === 'phi' || other === 'varphi' ? [0, Math.PI] : [0, 2 * Math.PI];
  if (name === 'phi' || name === 'varphi' || name === 't') return [0, 2 * Math.PI];
  return [-2, 2];
}

/* ------------------------------------------------------------------ drawing */
function render() {
  const v = st.view;
  if (!v) return;
  const kind = v.kind, R = st.range, env = Object.assign({}, st.params);
  view3d.active = false;
  if (kind === 'curve' || kind === 'complex') {
    const n = 400, x = st.axes[0];
    st.xs = new Array(n + 1); const a = new Array(n + 1), b = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const xv = -R + (2 * R * i) / n; env[x] = xv; st.xs[i] = xv;
      if (kind === 'curve') { a[i] = st.f(env); b[i] = st.showD ? st.df(env) : NaN; }
      else { const z = st.f(env); a[i] = z[0]; b[i] = z[1]; }
    }
    st.series = [{ ys: a, color: cssVar('--series-1') }];
    if (kind === 'complex' || st.showD) st.series.push({ ys: b, color: cssVar('--series-2'), dash: [6, 4] });
    const hv = st.hover !== null ? evalAt(st.hover) : null;
    st.geom = drawCurve(canvas, plot, { R, xs: st.xs, series: st.series, xLabel: plainSym(x), hoverX: st.hover, hoverVals: hv ? hv.slice(0, st.series.length) : [] });
    fillTable();
    canvas.setAttribute('aria-label', 'Plot against ' + plainSym(x) + ' from ' + fmt(-R) + ' to ' + fmt(R) + '. Open the values table below for numbers.');
  } else if (kind === 'surface' || kind === 'implicit') {
    const [x, y] = st.axes, f = st.f;
    const value = (xv, yv) => { env[x] = xv; env[y] = yv; return f(env); };
    if (kind === 'surface' && st.mode === '3d') {
      view3d.active = true;
      view3d.setScene(surfaceScene(value, R, { x: plainSym(x), y: plainSym(y), z: 'value' }));
      canvas.setAttribute('aria-label', 'Three-dimensional surface over ' + plainSym(x) + ' and ' + plainSym(y) + '.');
    } else {
      st.geom = drawMap(canvas, plot, { R, value, zeroOnly: kind === 'implicit', xLabel: plainSym(x), yLabel: plainSym(y), hover: st.hover });
      canvas.setAttribute('aria-label', (kind === 'implicit' ? 'Curve' : 'Map of values') + ' over ' + plainSym(x) + ' and ' + plainSym(y) + ', each from ' + fmt(-R) + ' to ' + fmt(R) + '.');
    }
  } else if (kind === 'field2d') {
    const [x, y] = v.coords, P = v.comps[0], Q = v.comps[1], h = 1e-3 * R;
    if (v.coords[2] === undefined && env.z === undefined) env.z = 0;
    const vec = (xv, yv) => { env[x] = xv; env[y] = yv; return [P(env), Q(env)]; };
    const shade = st.shade === 'strength' ? (xv, yv) => { const w = vec(xv, yv); return Math.hypot(w[0], w[1]); }
      : st.shade === 'curl' ? (xv, yv) => (vec(xv + h, yv)[1] - vec(xv - h, yv)[1] - vec(xv, yv + h)[0] + vec(xv, yv - h)[0]) / (2 * h)
        : (xv, yv) => (vec(xv + h, yv)[0] - vec(xv - h, yv)[0] + vec(xv, yv + h)[1] - vec(xv, yv - h)[1]) / (2 * h);
    st.fieldFns = { vec, shade };
    st.geom = drawMap(canvas, plot, { R, value: shade, diverging: st.shade !== 'strength', vector: vec, xLabel: plainSym(x), yLabel: plainSym(y), hover: st.hover });
    canvas.setAttribute('aria-label', 'Vector field over ' + plainSym(x) + ' and ' + plainSym(y) + ', coloured by ' + (st.shade === 'div' ? 'divergence' : st.shade) + '.');
  } else if (kind === 'field3d') {
    const [x, y, z] = v.coords, C = v.comps;
    const F = (xv, yv, zv) => { env[x] = xv; env[y] = yv; env[z] = zv; return [C[0](env), C[1](env), C[2](env)]; };
    const h = 1e-3 * R;
    const curl = (xv, yv, zv) => {
      const dx = [F(xv + h, yv, zv), F(xv - h, yv, zv)], dy = [F(xv, yv + h, zv), F(xv, yv - h, zv)], dz = [F(xv, yv, zv + h), F(xv, yv, zv - h)];
      const d = (pair, c) => (pair[0][c] - pair[1][c]) / (2 * h);
      return [d(dy, 2) - d(dz, 1), d(dz, 0) - d(dx, 2), d(dx, 1) - d(dy, 0)];
    };
    view3d.active = true;
    view3d.setScene(fieldScene(st.show3 === 'curl' ? curl : F, R, { x: plainSym(x), y: plainSym(y), z: plainSym(z) }));
    canvas.setAttribute('aria-label', 'Three-dimensional vector field.');
  } else if (kind === 'pcurve') {
    const t = st.axes[0], rng = paramRange(t, null), fs = v.fs;
    if (v.dims === 2) {
      const pts = [];
      for (let i = 0; i <= 500; i++) { env[t] = rng[0] + (rng[1] - rng[0]) * i / 500; pts.push([fs[0](env), fs[1](env)]); }
      drawPath(canvas, plot, pts, { x: 'x', y: 'y' });
    } else {
      view3d.active = true;
      const long = [rng[0], rng[0] + (rng[1] - rng[0]) * (rng[0] === 0 ? 3 : 1)];      // three turns for a space curve
      view3d.setScene(spaceCurveScene((tv) => { env[t] = tv; return [fs[0](env), fs[1](env), fs[2](env)]; }, long, { x: 'x', y: 'y', z: 'z' }));
    }
    canvas.setAttribute('aria-label', 'Curve traced by ' + plainSym(t) + '.');
  } else if (kind === 'psurface') {
    const [u, w] = st.axes, fs = v.fs;
    view3d.active = true;
    view3d.setScene(parametricSurfaceScene((uv, wv) => { env[u] = uv; env[w] = wv; return [fs[0](env), fs[1](env), fs[2](env)]; },
      [paramRange(u, w), paramRange(w, u)], { x: 'x', y: 'y', z: 'z' }));
    canvas.setAttribute('aria-label', 'Surface swept by ' + plainSym(u) + ' and ' + plainSym(w) + '.');
  }
  canvas.style.cursor = view3d.active ? 'grab' : 'crosshair';
}

function evalAt(x) {
  const env = Object.assign({}, st.params); env[st.axes[0]] = x;
  if (st.view.kind === 'complex') return st.f(env);
  return [st.f(env), st.df(env)];
}
function fillTable() {
  const t = $('#ms-table'), R = st.range, complex = st.view.kind === 'complex';
  t.textContent = '';
  const head = t.createTHead().insertRow();
  [plainSym(st.axes[0])].concat(complex ? ['Real part', 'Imaginary part'] : ['Function', 'Derivative']).forEach((h) => head.appendChild(el('th', '', h)));
  const body = t.createTBody();
  for (let k = 0; k <= 8; k++) {
    const x = -R + (2 * R * k) / 8, r = evalAt(x), row = body.insertRow();
    [x, r[0], r[1]].forEach((val) => { row.insertCell().textContent = fmt(val); });
  }
}
function showIR() {
  const v = st.view, p = {};
  paramNames().forEach((u) => { p[plainSym(u)] = st.params[u]; });
  $('#ms-ir').textContent = JSON.stringify({ kind: v.kind, axes: st.axes.map(plainSym), parameters: p, source: 'wikipedia' }, null, 1);
}

/* ------------------------------------------------------------------ pointer readouts */
function readout(pairs) {
  const out = $('#ms-readout'); out.textContent = '';
  pairs.forEach(([label, value], i) => { out.appendChild(document.createTextNode((i ? ' · ' : '') + label)); out.appendChild(el('b', '', value)); });
}
function pointer(ev) {
  const v = st.view;
  if (!v || view3d.active || !st.geom) return;
  if (v.kind === 'curve' || v.kind === 'complex') {
    const rect = canvas.getBoundingClientRect(), g = st.geom;
    let t = (ev.clientX - rect.left - g.m.l) / g.pw; t = Math.max(0, Math.min(1, t));
    const x = Math.round((-g.R + t * 2 * g.R) * 100) / 100, r = evalAt(x);
    st.hover = x;
    const pairs = [[plainSym(st.axes[0]) + ' = ', fmt(x)]];
    if (v.kind === 'complex') { pairs.push(['real ', fmt(r[0])]); pairs.push(['imaginary ', fmt(r[1])]); }
    else { pairs.push(['function ', fmt(r[0])]); if (st.showD) pairs.push(['derivative ', fmt(r[1])]); }
    readout(pairs); render();
  } else if ((v.kind === 'surface' && st.mode === 'map') || v.kind === 'field2d') {
    const p = st.geom.toData(ev.clientX, ev.clientY);
    if (!p) return;
    st.hover = p;
    if (v.kind === 'surface') {
      const env = Object.assign({}, st.params); env[st.axes[0]] = p[0]; env[st.axes[1]] = p[1];
      readout([[plainSym(st.axes[0]) + ' = ', fmt(p[0])], [plainSym(st.axes[1]) + ' = ', fmt(p[1])], ['value ', fmt(st.f(env))]]);
    } else {
      const w = st.fieldFns.vec(p[0], p[1]);
      readout([['at (', fmt(p[0]) + ', ' + fmt(p[1]) + ')'], ['field (', fmt(w[0]) + ', ' + fmt(w[1]) + ')'], [(st.shade === 'div' ? 'divergence ' : st.shade + ' '), fmt(st.fieldFns.shade(p[0], p[1]))]]);
    }
    render();
  }
}
canvas.addEventListener('pointerdown', pointer);
canvas.addEventListener('pointermove', pointer);
canvas.addEventListener('pointerleave', (ev) => {
  if (ev.pointerType === 'mouse' && st.view && !view3d.active && st.hover !== null) { st.hover = null; $('#ms-readout').textContent = hint(); render(); }
});
new ResizeObserver(() => { if (st.view) render(); }).observe(plot);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.view) render(); });

send({ type: 'ready' });
