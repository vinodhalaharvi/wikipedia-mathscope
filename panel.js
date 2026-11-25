/* MathScope panel.
   An extension page shown in an iframe beside the article. The math engine lives
   here, under the extension's own content security policy (no eval, no
   new Function), so plotting uses a small tree evaluator instead of the
   engine's compile(). */
import { ComputeEngine } from './vendor/compute-engine/compute-engine.js';

const $ = (s, r) => (r || document).querySelector(s);
const PARENT_ORIGIN = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
function send(msg) { window.parent.postMessage(Object.assign({ mathscope: true }, msg), PARENT_ORIGIN); }

/* ---- Tree evaluator: MathJSON -> closure(env) -> number ---- */
const CONSTS = { Pi: Math.PI, ExponentialE: Math.E, Half: 0.5, GoldenRatio: (1 + Math.sqrt(5)) / 2,
  PositiveInfinity: Infinity, NegativeInfinity: -Infinity, NaN: NaN };
export function compileJson(j) {
  if (typeof j === 'number') return () => j;
  if (typeof j === 'string') {
    if (Object.prototype.hasOwnProperty.call(CONSTS, j)) { const c = CONSTS[j]; return () => c; }
    if (/^[+-]?(\d|\.\d|Infinity)/.test(j)) { const n = parseFloat(j); return () => n; }
    return (env) => env[j];
  }
  if (!Array.isArray(j)) {
    if (j && j.num !== undefined) { const v = parseFloat(j.num); return () => v; }
    if (j && j.sym !== undefined) return compileJson(j.sym);
    if (j && j.fn !== undefined) return compileJson(j.fn);
    throw new Error('Unsupported node');
  }
  const h = j[0];
  const a = j.slice(1).map(compileJson);
  const a0 = a[0], a1 = a[1];
  switch (h) {
    case 'Add': return (e) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i](e); return s; };
    case 'Multiply': return (e) => { let p = 1; for (let i = 0; i < a.length; i++) p *= a[i](e); return p; };
    case 'Subtract': return (e) => a0(e) - a1(e);
    case 'Negate': return (e) => -a0(e);
    case 'Divide': case 'Rational': return (e) => a0(e) / a1(e);
    case 'Power': return (e) => Math.pow(a0(e), a1(e));
    case 'Square': return (e) => { const x = a0(e); return x * x; };
    case 'Sqrt': return (e) => Math.sqrt(a0(e));
    case 'Root': return (e) => Math.pow(a0(e), 1 / a1(e));
    case 'Exp': return (e) => Math.exp(a0(e));
    case 'Ln': return (e) => Math.log(a0(e));
    case 'Lb': return (e) => Math.log2(a0(e));
    case 'Log': return a1 ? (e) => Math.log(a0(e)) / Math.log(a1(e)) : (e) => Math.log10(a0(e));
    case 'Abs': return (e) => Math.abs(a0(e));
    case 'Sin': return (e) => Math.sin(a0(e));
    case 'Cos': return (e) => Math.cos(a0(e));
    case 'Tan': return (e) => Math.tan(a0(e));
    case 'Cot': return (e) => 1 / Math.tan(a0(e));
    case 'Sec': return (e) => 1 / Math.cos(a0(e));
    case 'Csc': return (e) => 1 / Math.sin(a0(e));
    case 'Arcsin': return (e) => Math.asin(a0(e));
    case 'Arccos': return (e) => Math.acos(a0(e));
    case 'Arctan': return (e) => Math.atan(a0(e));
    case 'Sinh': return (e) => Math.sinh(a0(e));
    case 'Cosh': return (e) => Math.cosh(a0(e));
    case 'Tanh': return (e) => Math.tanh(a0(e));
    case 'Sign': return (e) => Math.sign(a0(e));
    case 'Delimiter': case 'Annotated': case 'Hold': return a0;
    default: throw new Error('Unsupported operation: ' + h);
  }
}
function containsHead(j, heads) {
  if (!Array.isArray(j)) return false;
  if (heads.indexOf(j[0]) >= 0) return true;
  for (let i = 1; i < j.length; i++) if (containsHead(j[i], heads)) return true;
  return false;
}

/* ---- Classification: what kind of thing is this equation? ----
   The left-hand side is read with a pattern, not by the engine, so the answer
   never depends on what the engine saw in earlier formulas ("y" a variable in
   one equation, a function name in the next). Only the right-hand side is parsed. */
const NAME = String.raw`(?:\\(?:mathrm|text|mathit|operatorname)\s*\{\s*[A-Za-z]+\s*\}|\\[A-Za-z]+|[A-Za-z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?`;
const FN_DEF = new RegExp(String.raw`^\s*(${NAME})\s*(?:\\left\s*)?\(\s*(${NAME}(?:\s*,\s*${NAME})*)\s*(?:\\right\s*)?\)\s*=([\s\S]+)$`);
const SYM_DEF = new RegExp(String.raw`^\s*(${NAME})\s*=([\s\S]+)$`);
const NAME_G = new RegExp(NAME, 'g');
const BUILTIN_FN = /^\\(?:sin|cos|tan|cot|sec|csc|exp|ln|log|lg|arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|frac|det|max|min|lim|sum|int|prod)\b/;
/* Letters the engine reads as named constants. On Wikipedia they are almost
   always ordinary variables (a phase, a damping rate), so turn them back. */
const DEMOTE = { GoldenRatio: 'varphi', EulerGamma: 'gamma' };
const NOT_VARIABLES = { ImaginaryUnit: 1, ComplexInfinity: 1, True: 1, False: 1, Nothing: 1, Undefined: 1 };
function demote(j) {
  if (typeof j === 'string') return DEMOTE[j] || j;
  if (Array.isArray(j)) return [j[0]].concat(j.slice(1).map(demote));
  return j;
}
function collectSymbols(j, set) {
  if (typeof j === 'string') {
    if (!Object.prototype.hasOwnProperty.call(CONSTS, j) && !NOT_VARIABLES[j] && /^[A-Za-z]/.test(j)) set.add(j);
  } else if (Array.isArray(j)) {
    for (let i = 1; i < j.length; i++) collectSymbols(j[i], set);
  }
  return set;
}
function symbolOf(ce, tex) {
  const j = demote(ce.parse(tex).json);
  return typeof j === 'string' && /^[A-Za-z]/.test(j) && !Object.prototype.hasOwnProperty.call(CONSTS, j) ? j : null;
}
const MAX_SYMBOLS = 8;
/* Vector, matrix and operator notation is out of scope for a single curve. */
const NON_SCALAR = /\\(?:mathbf|boldsymbol|bold|mathsf|mathbb|mathcal|vec|hat|nabla|partial|times|wedge|otimes|oplus|star|begin|det|R\b|Z\b|C\b|N\b|operatorname\s*\{\s*(?:tr|curl|div|grad|var)\s*\})/;
export function classify(ce, tex) {
  const out = { kind: 'implicit', json: null, fnTex: null, declared: [], argTex: [], lhsLatex: 'y', unknowns: [] };
  if (NON_SCALAR.test(tex)) { out.kind = 'vector'; return out; }
  let rest = null;
  let m = FN_DEF.exec(tex);
  if (m && !BUILTIN_FN.test(m[1])) {
    out.fnTex = m[1].trim();
    out.argTex = m[2].match(NAME_G).map((t) => t.trim());
    out.declared = out.argTex.map((t) => symbolOf(ce, t));
    if (out.declared.some((d) => !d)) return out;
    out.lhsLatex = out.fnTex;
    rest = m[3];
  } else if ((m = SYM_DEF.exec(tex)) && !BUILTIN_FN.test(m[1])) {
    out.lhsLatex = m[1].trim();
    rest = m[2];
  } else {
    try { out.json = ce.parse(tex).json; } catch (err) { /* keep null */ }
    return out;
  }
  let e = ce.parse(rest);
  for (let guard = 0; guard < 4; guard++) {
    if ((e.operator === 'Tuple' || e.operator === 'Sequence' || e.operator === 'Delimiter') && e.ops && e.ops.length === 1) e = e.op1;
    else if ((e.operator === 'Equal' || e.operator === 'Approx') && e.ops && e.ops.length >= 2) e = e.op1;   /* a = b = c: keep b */
    else break;
  }
  out.json = e.json;
  if (typeof e.json === 'string') return out;
  /* "..." in a formula, or another function applied to the same argument
     (f(x) = 1 - g(x)), cannot be evaluated from this formula alone. */
  if (containsHead(e.json, ['ContinuationPlaceholder']) || JSON.stringify(e.json).indexOf('ContinuationPlaceholder') >= 0) { out.kind = 'unsupported'; out.reason = 'The formula contains an ellipsis'; return out; }
  if (out.argTex.length === 1) {
    const v = out.argTex[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const call = new RegExp(String.raw`(\\[A-Za-z]+|[A-Za-z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?\s*(?:\\left\s*)?\(\s*` + v + String.raw`\s*(?:\\right\s*)?\)`, 'g');
    let c;
    while ((c = call.exec(rest)) !== null) {
      if (!BUILTIN_FN.test(c[1]) && !/^\\(?:pi|cdot|times|left|right|frac|tfrac|dfrac)$/.test(c[1]) && c[1] !== 'e') { out.kind = 'unsupported'; out.reason = 'The formula refers to another function'; return out; }
    }
  }   /* h_1 = h_2 = 1: a bare symbol is not a curve */
  if (!e.isValid || containsHead(e.json, ['Error'])) { out.kind = 'unparsed'; return out; }
  if (containsHead(e.json, ['Integrate', 'Sum', 'Product', 'Limit', 'D', 'Derivative', 'PartialDerivative'])) { out.kind = 'identity'; return out; }
  out.rhsJson = demote(e.json);
  out.unknowns = Array.from(collectSymbols(out.rhsJson, new Set())).sort();
  if (out.declared.length > 1) { out.kind = 'multi'; return out; }
  if (!out.unknowns.length) { out.kind = 'constant'; return out; }
  if (out.unknowns.length > MAX_SYMBOLS) { out.kind = 'toomany'; return out; }
  try { compileJson(out.rhsJson); } catch (err) { out.kind = 'unsupported'; out.reason = err.message; return out; }
  /* Axis guess: the declared argument if there is one, else a conventional variable name. */
  const usual = ['x', 't', 'r', 'theta', 's', 'z', 'u', 'v', 'n', 'k'].filter((n) => out.unknowns.indexOf(n) >= 0)[0];
  out.variable = out.declared.length && out.unknowns.indexOf(out.declared[0]) >= 0 ? out.declared[0] : (usual || out.unknowns[0]);
  out.kind = 'plot';
  return out;
}

/* ---- helpers ---- */
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
function plainSym(s) {
  const parts = s.split('_');
  const base = GREEK[parts[0]] || parts[0];
  if (parts.length < 2) return base;
  const sub = parts.slice(1).join('');
  return base + (SUBS[sub] !== undefined ? SUBS[sub] : '_' + sub);
}
function symLatex(s) {
  const parts = s.split('_');
  const base = GREEK[parts[0]] ? '\\' + parts[0] : (parts[0].length > 1 ? '\\mathrm{' + parts[0] + '}' : parts[0]);
  return parts.length < 2 ? base : base + '_{' + parts.slice(1).map((p) => (GREEK[p] ? '\\' + p : p)).join('') + '}';
}
function fmt(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = (a !== 0 && (a >= 10000 || a < 0.001)) ? v.toExponential(2) : String(Number(v.toPrecision(3)));
  return s.replace('-', '−');
}
function niceStep(s) {
  const p = Math.pow(10, Math.floor(Math.log10(s))), f = s / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function defaultValue(name) { return /^(b|mu|phi|varphi|[A-Za-z]+_0)$/.test(name) ? 0 : 1; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function renderTex(el, src, display) {
  if (window.katex) {
    try {
      src = src.replace(/([A-Za-z0-9}])\s*\\exp/g, '$1\\,\\exp');
      el.innerHTML = window.katex.renderToString(src, { output: 'mathml', displayMode: !!display, throwOnError: false });
      el.querySelectorAll('annotation').forEach((n) => n.remove());
      el.classList.remove('tex-fallback');
      return;
    } catch (e) { /* fall through to plain source */ }
  }
  el.textContent = src;
  el.classList.add('tex-fallback');
}
function setMsg(el, strong, rest) {
  el.textContent = '';
  const b = document.createElement('strong'); b.textContent = strong;
  el.appendChild(b); el.appendChild(document.createTextNode(' ' + rest));
}

/* ---- state ---- */
const items = new Map();          /* id -> { tex, raw, kind } */
const scanEngine = new ComputeEngine();
const state = { eq: null, ce: null, variable: null, params: {}, range: 6, showD: true, f: null, df: null,
  hoverX: null, xs: [], ys: [], ds: [], dLatex: '' };
const canvas = $('#ms-canvas'), plot = $('#ms-plot'), ctx = canvas.getContext('2d');
let geom = null;

const REASONS = {
  multi: ['This function takes two or more inputs.', 'It needs a surface or contour plot, which this version leaves out.'],
  identity: ['This states a result.', 'It contains an integral, sum, limit or derivative, so there is no single curve to draw.'],
  constant: ['This is a fixed number.', 'Nothing varies, so there is nothing to plot.'],
  implicit: ['This is not written as a function.', 'This version only handles the form “name = expression”.'],
  toomany: ['This has too many symbols.', 'More than eight sliders would not be usable.'],
  unsupported: ['This uses an operation the plotter does not know yet.', ''],
  vector: ['This uses vector, matrix or operator notation.', 'This version only draws single curves.'],
  unparsed: ['The math engine could not parse this.', 'The TeX source is shown below.']
};

/* ---- messages from the content script ---- */
window.addEventListener('message', (ev) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data;
  if (!msg || msg.mathscope !== true) return;
  if (msg.type === 'classify') classifyAll(msg.items || []);
  else if (msg.type === 'select') select(msg.id);
});
$('#ms-close').addEventListener('click', () => send({ type: 'close' }));

function classifyAll(list) {
  /* One synchronous pass. No timers: Chrome slows timers to about one per second
     in an iframe that is not visible, which made long articles appear stuck. */
  const plottable = [];
  for (const it of list) {
    let kind = 'unparsed';
    try { kind = classify(scanEngine, String(it.tex)).kind; } catch (err) { kind = 'unparsed'; }
    items.set(it.id, { id: it.id, tex: String(it.tex), raw: String(it.raw || it.tex), kind });
    if (kind === 'plot') plottable.push(it.id);
  }
  $('#ms-status').textContent = 'Wikipedia · ' + plottable.length + ' of ' + list.length + ' equations can plot';
  send({ type: 'classified', plottable });
}

function select(id) {
  const it = items.get(id);
  if (!it) return;
  /* A fresh engine per equation, so symbols from one formula never leak into the next. */
  const ce = new ComputeEngine();
  let eq;
  try { eq = Object.assign({}, it, classify(ce, it.tex)); }
  catch (err) { eq = Object.assign({}, it, { kind: 'unparsed', json: null }); }
  state.eq = eq; state.ce = ce; state.hoverX = null;
  renderTex($('#ms-eq-render'), eq.tex, true);
  $('#ms-src').textContent = eq.raw;
  $('#ms-json').textContent = eq.json ? JSON.stringify(eq.json) : 'Not parsed.';
  const work = $('#ms-work'), msg = $('#ms-msg');
  if (eq.kind !== 'plot') {
    work.hidden = true; msg.hidden = false;
    const r = REASONS[eq.kind] || REASONS.unparsed;
    setMsg(msg, r[0], eq.kind === 'unsupported' ? (eq.reason || '') + '.' : r[1]);
    $('#ms-ir').textContent = JSON.stringify({ kind: eq.kind, plottable: false }, null, 1);
    return;
  }
  msg.hidden = true; work.hidden = false;
  state.params = {};
  eq.unknowns.forEach((u) => { state.params[u] = defaultValue(u); });
  state.f = compileJson(eq.rhsJson);
  buildVarChips(eq);
  setVariable(eq.variable);
}

function buildVarChips(eq) {
  const box = $('#ms-vars'); box.textContent = '';
  eq.unknowns.forEach((u, i) => {
    const lab = document.createElement('label'); lab.className = 'chip';
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = 'ms-var'; inp.id = 'ms-var-' + i; inp.value = u;
    inp.setAttribute('aria-label', plainSym(u));
    inp.addEventListener('change', () => setVariable(u));
    const sp = document.createElement('span'); renderTex(sp, symLatex(u), false);
    lab.appendChild(inp); lab.appendChild(sp); box.appendChild(lab);
  });
}

function setVariable(v) {
  const eq = state.eq;
  state.variable = v; state.hoverX = null;
  document.querySelectorAll('input[name="ms-var"]').forEach((r) => { r.checked = r.value === v; });
  const box = $('#ms-params'); box.textContent = '';
  const others = eq.unknowns.filter((u) => u !== v);
  others.forEach((u, i) => {
    const row = document.createElement('div'); row.className = 'param';
    const name = document.createElement('label'); name.htmlFor = 'ms-p-' + i; renderTex(name, symLatex(u), false);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.id = 'ms-p-' + i; inp.min = -5; inp.max = 5; inp.step = 0.05; inp.value = state.params[u];
    inp.setAttribute('aria-label', plainSym(u));
    const out = document.createElement('output'); out.htmlFor = inp.id; out.textContent = fmt(state.params[u]);
    inp.addEventListener('input', () => {
      state.params[u] = parseFloat(inp.value); out.textContent = fmt(state.params[u]);
      recompute(); draw(); showIR();
    });
    row.appendChild(name); row.appendChild(inp); row.appendChild(out); box.appendChild(row);
  });
  $('#ms-params-note').textContent = others.length
    ? 'Starting values are guesses. Every symbol not on the axis becomes a slider.'
    : 'This equation has no other symbols, so there is nothing to adjust.';
  state.df = null; state.dLatex = '';
  try {
    const d = state.ce.box(['D', eq.rhsJson, v]).evaluate().simplify();
    state.df = compileJson(d.json);
    state.dLatex = d.latex.replace(/\\mathrm\{(varphi|gamma)\}/g, '\\$1');
  } catch (err) { state.df = null; }
  const lhs = (eq.fnTex && eq.declared[0] === v) ? eq.fnTex + "'(" + symLatex(v) + ')'
    : '\\frac{\\partial ' + eq.lhsLatex + '}{\\partial ' + symLatex(v) + '}';
  if (state.df) renderTex($('#ms-deriv'), lhs + ' = ' + state.dLatex, true);
  else $('#ms-deriv').textContent = 'The engine could not differentiate this expression.';
  $('#ms-show-d').disabled = !state.df;
  $('#ms-readout').textContent = 'Hover the plot to read values.';
  recompute(); draw(); showIR();
}

function showIR() {
  const eq = state.eq, p = {};
  eq.unknowns.forEach((u) => { if (u !== state.variable) p[u] = state.params[u]; });
  $('#ms-ir').textContent = JSON.stringify({
    kind: 'scalar-function', variable: state.variable, parameters: p,
    inputDimension: 1, outputDimension: 1, source: 'wikipedia'
  }, null, 1);
}

/* ---- plot ---- */
function recompute() {
  if (!state.f) return;
  const n = 400, R = state.range, env = Object.assign({}, state.params);
  state.xs = new Array(n + 1); state.ys = new Array(n + 1); state.ds = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const x = -R + (2 * R * i) / n;
    env[state.variable] = x;
    state.xs[i] = x;
    state.ys[i] = state.f(env);
    state.ds[i] = state.df ? state.df(env) : NaN;
  }
  fillTable();
}
function evalAt(x) {
  const env = Object.assign({}, state.params); env[state.variable] = x;
  return [state.f(env), state.df ? state.df(env) : NaN];
}
function fillTable() {
  const t = $('#ms-table'), R = state.range;
  t.textContent = '';
  const head = t.createTHead().insertRow();
  [plainSym(state.variable), 'Function', 'Derivative'].forEach((h) => {
    const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
  });
  const body = t.createTBody();
  for (let k = 0; k <= 8; k++) {
    const x = -R + (2 * R * k) / 8, r = evalAt(x), row = body.insertRow();
    [x, r[0], r[1]].forEach((v) => { row.insertCell().textContent = fmt(v); });
  }
}

function draw() {
  if (!state.eq || state.eq.kind !== 'plot' || !state.f) return;
  const W = plot.clientWidth, H = 230;
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = { l: 46, r: 10, t: 10, b: 24 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const R = state.range, showD = state.showD && !!state.df, LIM = 1e6;
  let lo = 0, hi = 0, any = false;
  const scan = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (isFinite(v) && Math.abs(v) < LIM) { any = true; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  };
  scan(state.ys); if (showD) scan(state.ds);
  if (lo === hi) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
  if (lo === hi) hi = lo + step;
  const X = (x) => m.l + ((x + R) / (2 * R)) * pw;
  const Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * ph;
  geom = { m, pw, R };

  const cGrid = cssVar('--grid'), cMuted = cssVar('--muted'), cInk = cssVar('--ink'), cSurf = cssVar('--surface');
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const ny = Math.round((hi - lo) / step);
  for (let k = 0; k <= ny; k++) {
    const yv = lo + k * step, py = Math.round(Y(yv)) + 0.5, zero = Math.abs(yv) < step * 1e-6;
    ctx.strokeStyle = zero ? cMuted : cGrid;
    ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.stroke();
    ctx.fillStyle = cMuted; ctx.fillText(fmt(zero ? 0 : yv), m.l - 6, py);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let t = -3; t <= 3; t++) {
    const xv = (t * R) / 3, px = Math.round(X(xv)) + 0.5;
    if (t === 0) { ctx.strokeStyle = cMuted; ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke(); }
    ctx.fillStyle = cMuted; ctx.fillText(fmt(xv), px, m.t + ph + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = cInk;
  ctx.fillText(plainSym(state.variable), m.l + pw - 2, m.t + ph - 4);

  if (!any) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = cMuted;
    ctx.fillText('No real values with these settings.', m.l + pw / 2, m.t + ph / 2);
    return;
  }
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
  const curve = (arr, color, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!isFinite(v) || Math.abs(v) >= LIM) { pen = false; continue; }
      const px = X(state.xs[i]), py = Y(v);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  if (showD) curve(state.ds, cssVar('--series-2'), [6, 4]);
  curve(state.ys, cssVar('--series-1'), []);
  if (state.hoverX !== null) {
    const hx = state.hoverX, r = evalAt(hx), cx = Math.round(X(hx)) + 0.5;
    ctx.strokeStyle = cMuted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph); ctx.stroke();
    const dots = [[r[0], cssVar('--series-1')]];
    if (showD) dots.push([r[1], cssVar('--series-2')]);
    dots.forEach((d) => {
      if (!isFinite(d[0])) return;
      ctx.beginPath(); ctx.arc(X(hx), Y(d[0]), 5, 0, Math.PI * 2);
      ctx.fillStyle = d[1]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = cSurf; ctx.stroke();
    });
  }
  ctx.restore();
  canvas.setAttribute('aria-label', 'Plot against ' + plainSym(state.variable) + ' from ' + fmt(-R) + ' to ' + fmt(R) +
    '. Open the values table below for numbers.');
}

function pointer(ev) {
  if (!geom || !state.f) return;
  const rect = canvas.getBoundingClientRect();
  let t = (ev.clientX - rect.left - geom.m.l) / geom.pw;
  t = Math.max(0, Math.min(1, t));
  const x = Math.round((-geom.R + t * 2 * geom.R) * 100) / 100;
  state.hoverX = x;
  const r = evalAt(x), out = $('#ms-readout');
  out.textContent = '';
  const add = (label, value) => {
    out.appendChild(document.createTextNode(label));
    const b = document.createElement('b'); b.textContent = value; out.appendChild(b);
  };
  add(plainSym(state.variable) + ' = ', fmt(x));
  add(' · function ', fmt(r[0]));
  if (state.showD && state.df) add(' · derivative ', fmt(r[1]));
  draw();
}
canvas.addEventListener('pointerdown', pointer);
canvas.addEventListener('pointermove', pointer);
canvas.addEventListener('pointerleave', (ev) => {
  if (ev.pointerType === 'mouse') { state.hoverX = null; $('#ms-readout').textContent = 'Hover the plot to read values.'; draw(); }
});
$('#ms-show-d').addEventListener('change', (ev) => { state.showD = ev.target.checked; draw(); });
document.querySelectorAll('input[name="ms-range"]').forEach((r) => {
  r.addEventListener('change', () => { state.range = parseFloat(r.value); state.hoverX = null; recompute(); draw(); });
});
new ResizeObserver(() => draw()).observe(plot);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

send({ type: 'ready' });
