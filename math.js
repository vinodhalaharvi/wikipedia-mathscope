/* MathScope math layer: TeX splitting, classification and a tree evaluator.
   No DOM here, so it can be tested outside the browser.
   The evaluator walks MathJSON without eval or new Function, because the
   extension's content security policy (Manifest V3) forbids generated code. */

/* ------------------------------------------------------------------ numerics */
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  if (x < 2.5) {                                  // Maclaurin series, converges fast here
    let sum = x, term = x;
    for (let n = 1; n < 60; n++) { term *= -x * x / n; const add = term / (2 * n + 1); sum += add; if (Math.abs(add) < 1e-17) break; }
    return s * 2 / Math.sqrt(Math.PI) * sum;
  }
  // continued fraction for erfc
  let f = 0;
  for (let k = 60; k >= 1; k--) f = k / 2 / (x + f);
  return s * (1 - Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f));
}
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = LG[0];
  for (let i = 1; i < 9; i++) x += LG[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
function factorial(n) {
  if (Number.isInteger(n) && n >= 0 && n <= 170) { let p = 1; for (let k = 2; k <= n; k++) p *= k; return p; }
  return gamma(n + 1);
}
function factorial2(n) {
  if (!Number.isInteger(n) || n < -1) return NaN;
  let p = 1; for (let k = n; k > 1; k -= 2) p *= k; return p;
}
const UNARY = {
  Sqrt: Math.sqrt, Exp: Math.exp, Ln: Math.log, Lb: Math.log2, Lg: Math.log10, Abs: Math.abs, Sign: Math.sign,
  Floor: Math.floor, Ceil: Math.ceil, Round: Math.round, Negate: (x) => -x, Square: (x) => x * x,
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Cot: (x) => 1 / Math.tan(x), Sec: (x) => 1 / Math.cos(x), Csc: (x) => 1 / Math.sin(x),
  Arcsin: Math.asin, Arccos: Math.acos, Arctan: Math.atan, Arccot: (x) => Math.PI / 2 - Math.atan(x),
  Sinh: Math.sinh, Cosh: Math.cosh, Tanh: Math.tanh, Coth: (x) => 1 / Math.tanh(x), Sech: (x) => 1 / Math.cosh(x), Csch: (x) => 1 / Math.sinh(x),
  Arsinh: Math.asinh, Arcosh: Math.acosh, Artanh: Math.atanh, Arcsinh: Math.asinh, Arccosh: Math.acosh, Arctanh: Math.atanh,
  Sinc: (x) => (x === 0 ? 1 : Math.sin(x) / x), Erf: erf, Erfc: (x) => 1 - erf(x), Gamma: gamma,
  LogGamma: (x) => Math.log(Math.abs(gamma(x))), Factorial: factorial, Factorial2: factorial2
};
const CONSTS = { Pi: Math.PI, ExponentialE: Math.E, Half: 0.5, GoldenRatio: (1 + Math.sqrt(5)) / 2,
  PositiveInfinity: Infinity, NegativeInfinity: -Infinity, NaN: NaN, EulerGamma: 0.5772156649015329 };
const NOT_VARIABLES = { ImaginaryUnit: 1, ComplexInfinity: 1, True: 1, False: 1, Nothing: 1, Undefined: 1, ContinuationPlaceholder: 1 };
const isConst = (s) => Object.prototype.hasOwnProperty.call(CONSTS, s);
const BINDERS = { Sum: 1, Product: 1, Integrate: 1 };
const INTEGRAL_REACH = 10;            // infinite integration limits are cut here
export const DEFAULT_TERMS = 20;

function boundVar(j) {                 // variable bound by a Sum / Product / Integrate node
  const lim = j[2];
  if (Array.isArray(lim) && typeof lim[1] === 'string') return lim[1];
  if (Array.isArray(j[1]) && j[1][0] === 'Function' && typeof j[1][2] === 'string') return j[1][2];
  return null;
}

/* ------------------------------------------------------------------ real evaluator */
export function compileJson(j, ctx) {
  ctx = ctx || {};
  if (typeof j === 'number') return () => j;
  if (typeof j === 'string') {
    if (isConst(j)) { const c = CONSTS[j]; return () => c; }
    if (/^[+-]?(\d|\.\d|Infinity)/.test(j)) { const n = parseFloat(j); return () => n; }
    if (NOT_VARIABLES[j]) throw new Error('Unsupported symbol: ' + j);
    return (env) => env[j];
  }
  if (!Array.isArray(j)) {
    if (j && j.num !== undefined) { const v = parseFloat(j.num); return () => v; }
    if (j && j.sym !== undefined) return compileJson(j.sym, ctx);
    if (j && j.fn !== undefined) return compileJson(j.fn, ctx);
    throw new Error('Unsupported node');
  }
  const h = j[0];
  if (h === 'Sum' || h === 'Product') {
    const lim = j[2], v = boundVar(j);
    if (!v || !Array.isArray(lim) || lim.length < 4) throw new Error('Sum without limits');
    const body = compileJson(j[1], ctx), lo = compileJson(lim[2], ctx), hi = compileJson(lim[3], ctx), sum = h === 'Sum';
    return (e) => {
      const a = Math.round(lo(e)); let b = hi(e);
      if (!isFinite(a)) return NaN;
      b = isFinite(b) ? Math.min(Math.round(b), a + 500) : a + Math.max(1, Math.round(e.__terms || DEFAULT_TERMS)) - 1;
      const save = e[v]; let s = sum ? 0 : 1;
      for (let k = a; k <= b; k++) { e[v] = k; const t = body(e); s = sum ? s + t : s * t; }
      e[v] = save; return s;
    };
  }
  if (h === 'Integrate') {
    const lim = j[2], v = boundVar(j);
    if (!v || !Array.isArray(lim) || lim.length < 4) throw new Error('Integral without limits');
    const body = compileJson(j[1], ctx), lo = compileJson(lim[2], ctx), hi = compileJson(lim[3], ctx);
    return (e) => {
      let a = lo(e), b = hi(e);
      if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
      a = Math.max(-INTEGRAL_REACH, Math.min(INTEGRAL_REACH, a)); b = Math.max(-INTEGRAL_REACH, Math.min(INTEGRAL_REACH, b));
      const n = 160, hstep = (b - a) / n, save = e[v];
      let s = 0;
      for (let k = 0; k <= n; k++) { e[v] = a + k * hstep; const y = body(e); s += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * (isFinite(y) ? y : 0); }
      e[v] = save; return s * hstep / 3;
    };
  }
  if (h === 'Function') return compileJson(j[1], ctx);
  if (h === 'Block') return compileJson(j[j.length - 1], ctx);
  if (h === 'Which') {
    const pairs = [];
    for (let i = 1; i + 1 < j.length; i += 2) pairs.push([compileCond(j[i], ctx), compileJson(j[i + 1], ctx)]);
    return (e) => { for (let i = 0; i < pairs.length; i++) if (pairs[i][0](e)) return pairs[i][1](e); return NaN; };
  }
  if (ctx.fns && ctx.fns.has(h)) {                 // a function defined elsewhere on the page
    const fn = ctx.fns.get(h);
    if (fn.busy) throw new Error('The definition refers to itself');
    if (!fn.compiled) { fn.busy = true; try { fn.compiled = compileJson(fn.json, ctx); } finally { fn.busy = false; } }
    const arg = compileJson(j[1], ctx), name = fn.arg, body = fn.compiled;
    return (e) => { const x = arg(e), save = e[name]; e[name] = x; const y = body(e); e[name] = save; return y; };
  }
  const a = j.slice(1).map((x) => compileJson(x, ctx));
  const a0 = a[0], a1 = a[1];
  if (UNARY[h] && a.length === 1) { const f = UNARY[h]; return (e) => f(a0(e)); }
  switch (h) {
    case 'Add': return (e) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i](e); return s; };
    case 'Multiply': return (e) => { let p = 1; for (let i = 0; i < a.length; i++) p *= a[i](e); return p; };
    case 'Subtract': return (e) => a0(e) - a1(e);
    case 'Divide': case 'Rational': return (e) => a0(e) / a1(e);
    case 'Power': return (e) => Math.pow(a0(e), a1(e));
    case 'Root': return (e) => Math.pow(a0(e), 1 / a1(e));
    case 'Log': return a1 ? (e) => Math.log(a0(e)) / Math.log(a1(e)) : (e) => Math.log10(a0(e));
    case 'Arctan2': return (e) => Math.atan2(a0(e), a1(e));
    case 'Min': return (e) => { let m = Infinity; for (let i = 0; i < a.length; i++) m = Math.min(m, a[i](e)); return m; };
    case 'Max': return (e) => { let m = -Infinity; for (let i = 0; i < a.length; i++) m = Math.max(m, a[i](e)); return m; };
    case 'Mod': return (e) => { const m = a1(e); return ((a0(e) % m) + m) % m; };
    case 'Binomial': return (e) => factorial(a0(e)) / (factorial(a1(e)) * factorial(a0(e) - a1(e)));
    case 'Delimiter': case 'Annotated': case 'Hold': return a0;
    case 'List': case 'Tuple': case 'Sequence': if (a.length === 1) return a0; break;
    default:
  }
  throw new Error('Unsupported operation: ' + h);
}
function compileCond(j, ctx) {
  if (j === 'True') return () => true;
  if (j === 'False') return () => false;
  if (!Array.isArray(j)) throw new Error('Unsupported condition');
  const h = j[0];
  if (h === 'And' || h === 'Or' || h === 'Not') {
    const c = j.slice(1).map((x) => compileCond(x, ctx));
    if (h === 'Not') return (e) => !c[0](e);
    return h === 'And' ? (e) => c.every((f) => f(e)) : (e) => c.some((f) => f(e));
  }
  const cmp = { Less: (x, y) => x < y, LessEqual: (x, y) => x <= y, Greater: (x, y) => x > y, GreaterEqual: (x, y) => x >= y,
    Equal: (x, y) => x === y, NotEqual: (x, y) => x !== y }[h];
  if (!cmp) throw new Error('Unsupported condition: ' + h);
  const a = j.slice(1).map((x) => compileJson(x, ctx));
  return (e) => { for (let i = 0; i + 1 < a.length; i++) if (!cmp(a[i](e), a[i + 1](e))) return false; return true; };
}

/* ------------------------------------------------------------------ complex evaluator */
export function hasComplex(j) {
  if (j === 'ImaginaryUnit') return true;
  if (!Array.isArray(j)) return false;
  if (j[0] === 'Complex') return true;
  for (let i = 1; i < j.length; i++) if (hasComplex(j[i])) return true;
  return false;
}
const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
const cdiv = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
const cexp = (p) => { const m = Math.exp(p[0]); return [m * Math.cos(p[1]), m * Math.sin(p[1])]; };
const clog = (p) => [Math.log(Math.hypot(p[0], p[1])), Math.atan2(p[1], p[0])];
export function compileComplex(j, ctx) {
  if (!hasComplex(j)) { const f = compileJson(j, ctx); return (e) => [f(e), 0]; }
  if (j === 'ImaginaryUnit') return () => [0, 1];
  const h = j[0];
  if (h === 'Complex') { const re = Number(j[1]), im = Number(j[2]); return () => [re, im]; }
  const a = j.slice(1).map((x) => compileComplex(x, ctx));
  const a0 = a[0], a1 = a[1];
  switch (h) {
    case 'Add': return (e) => { let re = 0, im = 0; for (let i = 0; i < a.length; i++) { const v = a[i](e); re += v[0]; im += v[1]; } return [re, im]; };
    case 'Multiply': return (e) => { let p = [1, 0]; for (let i = 0; i < a.length; i++) p = cmul(p, a[i](e)); return p; };
    case 'Negate': return (e) => { const v = a0(e); return [-v[0], -v[1]]; };
    case 'Subtract': return (e) => { const p = a0(e), q = a1(e); return [p[0] - q[0], p[1] - q[1]]; };
    case 'Divide': return (e) => cdiv(a0(e), a1(e));
    case 'Exp': return (e) => cexp(a0(e));
    case 'Ln': return (e) => clog(a0(e));
    case 'Sqrt': return (e) => cexp(cmul([0.5, 0], clog(a0(e))));
    case 'Power': return (e) => { const b = a0(e), w = a1(e); if (b[0] === 0 && b[1] === 0) return [0, 0]; return cexp(cmul(w, clog(b))); };
    case 'Sin': return (e) => { const z = a0(e); return [Math.sin(z[0]) * Math.cosh(z[1]), Math.cos(z[0]) * Math.sinh(z[1])]; };
    case 'Cos': return (e) => { const z = a0(e); return [Math.cos(z[0]) * Math.cosh(z[1]), -Math.sin(z[0]) * Math.sinh(z[1])]; };
    case 'Abs': return (e) => { const z = a0(e); return [Math.hypot(z[0], z[1]), 0]; };
    case 'Conjugate': return (e) => { const z = a0(e); return [z[0], -z[1]]; };
    case 'Real': return (e) => [a0(e)[0], 0];
    case 'Imaginary': return (e) => [a0(e)[1], 0];
    case 'Delimiter': case 'Hold': return a0;
    case 'List': case 'Tuple': case 'Sequence': if (a.length === 1) return a0; break;
    default:
  }
  throw new Error('Unsupported complex operation: ' + h);
}

/* ------------------------------------------------------------------ tree helpers */
export function containsHead(j, heads) {
  if (!Array.isArray(j)) return false;
  if (heads.indexOf(j[0]) >= 0) return true;
  for (let i = 1; i < j.length; i++) if (containsHead(j[i], heads)) return true;
  return false;
}
function mentions(j, sym) { return JSON.stringify(j).indexOf('"' + sym + '"') >= 0; }
/* Letters the engine reads as named constants; on Wikipedia they are almost always variables. */
const DEMOTE = { GoldenRatio: 'varphi', EulerGamma: 'gamma' };
function demote(j) {
  if (typeof j === 'string') return DEMOTE[j] || j;
  if (Array.isArray(j)) return [j[0]].concat(j.slice(1).map(demote));
  return j;
}
export function collectSymbols(j, set, ctx, bound) {
  if (typeof j === 'string') {
    if (!isConst(j) && !NOT_VARIABLES[j] && /^[A-Za-z]/.test(j) && !(bound && bound.has(j))) set.add(j);
  } else if (Array.isArray(j)) {
    const h = j[0];
    let b = bound;
    if (BINDERS[h] || h === 'Function') { const v = boundVar(j) || (h === 'Function' ? j[2] : null); if (v) { b = new Set(bound || []); b.add(v); } }
    if (ctx && ctx.fns && ctx.fns.has(h)) {
      const fn = ctx.fns.get(h);
      if (!fn.walking) { fn.walking = true; const inner = new Set(); collectSymbols(fn.json, inner, ctx, new Set([fn.arg])); fn.walking = false; inner.forEach((s) => { if (!(b && b.has(s))) set.add(s); }); }
    }
    for (let i = 1; i < j.length; i++) collectSymbols(j[i], set, ctx, b);
  }
  return set;
}
/* A sum whose terms never mention the counting variable is a sum over indexed data (x_i). */
function sumOverIndexed(j) {
  if (!Array.isArray(j)) return false;
  if (j[0] === 'Sum' || j[0] === 'Product') { const v = boundVar(j); if (!v || !mentions(j[1], v)) return true; }
  for (let i = 1; i < j.length; i++) if (sumOverIndexed(j[i])) return true;
  return false;
}
function infiniteSum(j) {
  if (!Array.isArray(j)) return false;
  if ((j[0] === 'Sum' || j[0] === 'Product') && Array.isArray(j[2]) && (j[2][3] === 'PositiveInfinity' || mentions(j[2][3], 'PositiveInfinity'))) return true;
  for (let i = 1; i < j.length; i++) if (infiniteSum(j[i])) return true;
  return false;
}
function usesFnsDeep(j, ctx, seen) {
  if (!Array.isArray(j)) return false;
  if (ctx.fns && ctx.fns.has(j[0])) return true;
  for (let i = 1; i < j.length; i++) if (usesFnsDeep(j[i], ctx, seen)) return true;
  return false;
}

/* ------------------------------------------------------------------ TeX utilities */
export function cleanTex(tex) {
  let t = String(tex).replace(/\\(?:displaystyle|textstyle|scriptstyle)\b\s*/g, '').trim();
  let prev;
  do {
    prev = t;
    t = t.replace(/(?:\\[,;:! ]|\\q?quad|~|\s)+$/, '').replace(/[.,;]$/, '');
  } while (t !== prev);
  return t;
}
/* Split at the top nesting level. `test(tex, i)` returns the separator's length at i, or 0. */
function topSplit(tex, test) {
  const out = []; let depth = 0, start = 0, i = 0;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === '\\') {
      const rest = tex.slice(i, i + 8);
      if (/^\\begin/.test(rest)) { depth++; i += 6; continue; }
      if (/^\\end\b/.test(rest) || rest.startsWith('\\end{')) { depth = Math.max(0, depth - 1); i += 4; continue; }
      if (rest.startsWith('\\langle')) { depth++; i += 7; continue; }
      if (rest.startsWith('\\rangle')) { depth = Math.max(0, depth - 1); i += 7; continue; }
      if (depth === 0) { const n = test(tex, i); if (n) { out.push(tex.slice(start, i)); i += n; start = i; continue; } }
      if (/^\\[{}()[\]|\\]/.test(rest)) { i += 2; continue; }      // escaped delimiter or a nested row break
      i++; continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) { const n = test(tex, i); if (n) { out.push(tex.slice(start, i)); i += n; start = i; continue; } }
    i++;
  }
  out.push(tex.slice(start));
  return out;
}
const isEq = (t, i) => (t[i] === '=' && !/[<>:!]/.test(t[i - 1] || '') ? 1 : 0);
export function eqSplit(tex) { return topSplit(tex, isEq); }
const isRow = (t, i) => (t[i] === '\\' && t[i + 1] === '\\' ? 2 : 0);
const isAmp = (t, i) => (t[i] === '&' ? 1 : 0);
const isListSep = (t, i) => {
  if ((t[i] === ',' || t[i] === ';') && t[i - 1] !== '\\') return 1;
  if (t.startsWith('\\qquad', i)) return 6;
  if (t.startsWith('\\quad', i)) return 5;
  return 0;
};
const ROWS_ENV = /^\\begin\s*\{(align\*?|aligned|alignat\*?|alignedat|gather\*?|gathered|split|eqnarray\*?)\}([\s\S]*)\\end\s*\{\1\}$/;
/* One Wikipedia formula can hold several statements: rows of an align block,
   or definitions separated by commas. Return each as its own piece of TeX. */
export function splitParts(tex) {
  const t = cleanTex(tex);
  const env = ROWS_ENV.exec(t);
  let rows = [t];
  if (env) rows = topSplit(/^alignat|^alignedat/.test(env[1]) ? env[2].replace(/^\s*\{[^{}]*\}/, '') : env[2], isRow).map((r) => topSplit(r.replace(/^\s*\[[^\]]*\]/, ''), isAmp).join(' '));
  const parts = [];
  for (const row of rows) {
    for (const piece of topSplit(row, isListSep)) {
      const p = cleanTex(piece);
      if (!p) continue;
      if (/^(=|\\approx|\\propto|\\sim|\\equiv)/.test(p)) continue;        // continuation of the row above
      if (eqSplit(p).length > 1) parts.push(p);
      else if (parts.length && !/\\in\b|\\ge|\\le|\\neq|\\text|[<>]/.test(p)) parts[parts.length - 1] += ', ' + p;
    }
  }
  return parts.slice(0, 8);
}

const NAME = String.raw`(?:\\(?:mathrm|text|mathit|operatorname)\s*\{\s*[A-Za-z]+\s*\}|\\[A-Za-z]+|[A-Za-z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?`;
const VNAME = String.raw`(?:\\(?:mathbf|boldsymbol|bold|vec|overrightarrow)\s*(?:\{\s*[A-Za-z]\s*\}|[A-Za-z])|\\vec\s*\{\s*\\mathbf\s*\{?[A-Za-z]\}?\s*\})`;
const ARGS = String.raw`(${NAME}(?:\s*,\s*${NAME})*)`;
const FN_LHS = new RegExp(String.raw`^\s*(${NAME})\s*(?:\\left\s*)?\(\s*${ARGS}\s*(?:\\right\s*)?\)\s*$`);
const SYM_LHS = new RegExp(String.raw`^\s*(${NAME})\s*$`);
const VEC_LHS = new RegExp(String.raw`^\s*(${VNAME})\s*(?:(?:\\left\s*)?\(\s*${ARGS}\s*(?:\\right\s*)?\))?\s*$`);
const NAME_G = new RegExp(NAME, 'g');
const BUILTIN_FN = /^\\(?:sin|cos|tan|cot|sec|csc|exp|ln|log|lg|arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|frac|det|max|min|lim|sum|int|prod|Gamma|operatorname\s*\{\s*(?:erf|erfc|sgn|sinc|arsinh|arcosh|artanh)\s*\})/;
const NON_SCALAR = /\\(?:mathbf|boldsymbol|bold|mathsf|mathbb|mathcal|vec|hat|nabla|partial|times|wedge|otimes|oplus|star|det|R\b|Z\b|C\b|N\b|operatorname\s*\{\s*(?:tr|curl|div|grad|var|E|P|Var|Cov)\s*\})|\\begin\s*\{(?!cases)/;

/* Unit vectors in their many spellings -> placeholder symbols. */
const UNIT = [['msI', String.raw`(?:\\imath|i|x)`, 'i', '(?:x|1)'], ['msJ', String.raw`(?:\\jmath|j|y)`, 'j', '(?:y|2)'], ['msK', '(?:k|z)', 'k', '(?:z|3)']];
const BOLD = String.raw`\\(?:boldsymbol|mathbf|bold|bm|vec)`;
function unitVectors(tex) {
  let t = tex;
  for (const [sym, hatLetter, boldLetter, sub] of UNIT) {
    const rep = ' \\mathrm{' + sym + '} ';
    const pats = [
      String.raw`${BOLD}\s*\{\s*\\hat\s*\{?\s*${hatLetter}\s*\}?\s*\}`,
      String.raw`\\hat\s*\{\s*${BOLD}\s*\{?\s*${hatLetter}\s*\}?\s*\}`,
      String.raw`\\hat\s*\{\s*${BOLD}\s*\{?\s*e\s*\}?\s*\}\s*_\s*\{?\s*${sub}\s*\}?`,
      String.raw`${BOLD}\s*\{\s*\\hat\s*\{?\s*e\s*\}?\s*\}\s*_\s*\{?\s*${sub}\s*\}?`,
      String.raw`${BOLD}\s*\{\s*e\s*\}\s*_\s*\{?\s*${sub}\s*\}?`,
      String.raw`\\hat\s*\{\s*${hatLetter}\s*\}`,
      String.raw`\\hat\s*\\[ij]math`,
      String.raw`${BOLD}\s*\{\s*${boldLetter}\s*\}`
    ];
    for (const p of pats) {
      if (p.indexOf('[ij]math') >= 0) { if (sym === 'msI') t = t.replace(/\\hat\s*\\imath/g, rep); else if (sym === 'msJ') t = t.replace(/\\hat\s*\\jmath/g, rep); continue; }
      t = t.replace(new RegExp(p, 'g'), rep);
    }
  }
  return t;
}
/* Run one formula in its own engine scope, so what the engine infers about a
   symbol (a variable here, a function name there) never leaks into the next formula. */
export function scoped(ce, fn) {
  if (typeof ce.pushScope !== 'function') return fn();
  ce.pushScope();
  try { return fn(); } finally { ce.popScope(); }
}
/* "a(x - b)" is a coefficient times a bracket, but the engine reads it as a call to a
   function named a. Where a plain coefficient letter meets a bracket holding a sum,
   spell the multiplication out. Letters that usually name functions (f, g, h) are left alone. */
const COEFF = /(^|[^A-Za-z\\])((?:\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|lambda|mu|nu|sigma|tau|omega|kappa|rho|theta|eta|zeta|xi|chi)|[a-eA-Ei-zI-Z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?)\s*((?:\\left\s*)?\()/g;
function insertTimes(tex) {
  let out = '', last = 0, m;
  COEFF.lastIndex = 0;
  while ((m = COEFF.exec(tex)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < tex.length; i++) {
      if (tex[i] === '\\') { i++; continue; }
      if (tex[i] === '(') depth++;
      else if (tex[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const inner = tex.slice(open + 1, close);
    const pieces = topSplit(inner, (t, i) => ((t[i] === '+' || t[i] === '-') && i > 0 && t.slice(0, i).trim() !== '' ? 1 : 0));
    if (pieces.length < 2) continue;
    const at = m.index + m[1].length + m[2].length;
    out += tex.slice(last, at) + '\\cdot ';
    last = at;
  }
  return out + tex.slice(last);
}
function prepCases(tex) {
  if (tex.indexOf('\\begin{cases}') < 0 && !/\\begin\s*\{cases\}/.test(tex)) return tex;
  return tex.replace(/\\text\s*\{\s*(?:if|for|when|where)\s*\}/g, ' ').replace(/([^\\])[.,;]\s*(\\\\|\\end)/g, '$1 $2');
}
function symbolOf(ce, tex) {
  const j = demote(ce.parse(tex).json);
  return typeof j === 'string' && /^[A-Za-z]/.test(j) && !isConst(j) ? j : null;
}
function parseExpr(ce, tex) {
  let e = ce.parse(insertTimes(prepCases(tex)));
  for (let guard = 0; guard < 4; guard++) {
    if ((e.operator === 'Tuple' || e.operator === 'Sequence' || e.operator === 'Delimiter' || e.operator === 'List') && e.ops && e.ops.length === 1) e = e.op1;
    else break;
  }
  const json = demote(e.json);
  const ok = e.isValid && !containsHead(json, ['Error']) && JSON.stringify(json).indexOf('ContinuationPlaceholder') < 0;
  return { json, ok };
}
const AXIS_ORDER = ['x', 't', 'r', 'theta', 's', 'z', 'u', 'v', 'n', 'k'];

/* ------------------------------------------------------------------ page-level function table */
export function buildFunctionTable(ce, itemsParts) {
  const table = { byTex: new Map(), fns: new Map() };
  let n = 0;
  for (const parts of itemsParts) for (const tex of parts) {
    const segs = eqSplit(tex);
    if (segs.length < 2) continue;
    const m = FN_LHS.exec(segs[0]);
    if (!m || BUILTIN_FN.test(m[1])) continue;
    const args = m[2].match(NAME_G);
    if (args.length !== 1) continue;
    const key = m[1].replace(/\s+/g, '');
    if (table.byTex.has(key)) continue;
    const arg = scoped(ce, () => symbolOf(ce, args[0]));
    if (!arg) continue;
    const id = 'msfn' + 'abcdefghijklmnopqrstuvwxyz'[n % 26] + (n >= 26 ? Math.floor(n / 26) : '');
    n++;
    table.byTex.set(key, { id, nameTex: m[1].trim(), arg, rhsTex: segs.slice(1), json: null });
  }
  /* resolve bodies after all names are known, so definitions may refer to each other */
  for (const entry of table.byTex.values()) {
    for (let k = entry.rhsTex.length - 1; k >= 0 && !entry.json; k--) {
      const body = topSplit(entry.rhsTex[k], (t, i) => (t.startsWith('\\approx', i) ? 7 : 0))[0];
      if (NON_SCALAR.test(body)) continue;
      try { const p = scoped(ce, () => parseExpr(ce, rewriteCalls(body, table, entry.id, true))); if (p.ok && typeof p.json !== 'string') entry.json = p.json; } catch (err) { /* try the next form */ }
    }
    if (entry.json) table.fns.set(entry.id, { arg: entry.arg, json: entry.json, compiled: null, busy: false });
  }
  return table;
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rewriteCalls(tex, table, exceptId, building) {
  if (!table) return tex;
  let t = tex;
  for (const entry of table.byTex.values()) {
    if (entry.id === exceptId || (!building && !table.fns.has(entry.id))) continue;
    const name = escRe(entry.nameTex).replace(/\\ /g, '\\s*').replace(/ /g, '\\s*');
    const re = new RegExp('(^|[^A-Za-z\\\\])' + name + String.raw`\s*(\{\s*)?((?:\\left\s*)?\()`, 'g');
    t = t.replace(re, (all, pre, brace, open) => pre + (brace || '') + '\\operatorname{' + entry.id + '}' + open);
  }
  return t;
}

/* ------------------------------------------------------------------ classification */
const MAX_SYMBOLS = 8;
const none = (reason, extra) => Object.assign({ kind: 'none', reason }, extra || {});
function defaultEnv(unknowns) { const e = { __terms: DEFAULT_TERMS }; unknowns.forEach((u) => { e[u] = defaultValue(u); }); return e; }
export function defaultValue(name) { return /^(mu|phi|varphi|[A-Za-z]+_0)$/.test(name) ? 0 : 1; }
/* Symbols that shift an axis variable, as b does in (x - b): they start at 0, not 1. */
export function locationLike(j, axes, out) {
  out = out || new Set();
  if (!Array.isArray(j)) return out;
  if (j[0] === 'Add' || j[0] === 'Subtract') {
    const terms = j.slice(1).map((t) => (Array.isArray(t) && t[0] === 'Negate' ? t[1] : t));
    if (terms.some((t) => typeof t === 'string' && axes.indexOf(t) >= 0)) terms.forEach((t) => { if (typeof t === 'string' && axes.indexOf(t) < 0) out.add(t); });
  }
  for (let i = 1; i < j.length; i++) locationLike(j[i], axes, out);
  return out;
}

function scalarView(ce, lhs, rhsTex, table) {
  /* lhs: { fnTex, argTex[], declared[], lhsLatex, lhsSym } */
  const ctx = { fns: table ? table.fns : new Map() };
  const tex = rewriteCalls(rhsTex, table, lhs.selfId);
  if (lhs.argTex.length === 1) {          // f(x) = 1 - g(x) with g unknown: not computable from here
    const v = escRe(lhs.argTex[0]);
    const call = new RegExp(String.raw`(\\[A-Za-z]+|[A-Za-z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?\s*(?:\\left\s*)?\(\s*` + v + String.raw`\s*(?:\\right\s*)?\)`, 'g');
    let c;
    while ((c = call.exec(tex)) !== null) {
      if (!BUILTIN_FN.test(c[1]) && !/^\\(?:pi|cdot|times|left|right|frac|tfrac|dfrac|operatorname)$/.test(c[1]) && c[1] !== 'e') return none('The formula refers to a function that is not defined on this page');
    }
  }
  if (lhs.fnTex && new RegExp('(^|[^A-Za-z\\\\])' + escRe(lhs.fnTex) + '(?![A-Za-z])').test(rhsTex)) return none('The formula defines the function in terms of itself');
  if (NON_SCALAR.test(tex)) return none('This uses vector, matrix or operator notation');
  const p = parseExpr(ce, tex);
  if (!p.ok) return none('The math engine could not parse this', { json: p.json });
  const json = p.json;
  const base = { json, rhsJson: json, lhsLatex: lhs.lhsLatex, fnTex: lhs.fnTex, declared: lhs.declared, lhsSym: lhs.lhsSym, ctx };
  if (containsHead(json, ['Limit', 'D', 'Derivative', 'PartialDerivative'])) return none('This contains a limit or a derivative', base);
  if (typeof json === 'string') return none('This only renames a symbol', base);
  if (sumOverIndexed(json)) return none('This adds up indexed quantities such as x_i, which have no values here', base);
  const unknowns = Array.from(collectSymbols(json, new Set(), ctx)).sort();
  base.unknowns = unknowns;
  base.usesTerms = infiniteSum(json) || Array.from(ctx.fns.keys()).some((id) => mentions(json, id) && infiniteSum(ctx.fns.get(id).json));
  base.numericOnly = containsHead(json, ['Sum', 'Product', 'Integrate', 'Which']) || usesFnsDeep(json, ctx);
  if (!unknowns.length) return none('This is a fixed number', base);
  if (unknowns.length > MAX_SYMBOLS) return none('This has too many symbols', base);
  const complex = hasComplex(json);
  try { if (complex) compileComplex(json, ctx); else compileJson(json, ctx); }
  catch (err) { return none(err.message, base); }
  if (containsHead(json, ['Integrate']) && !containsHead(json, ['Limits'])) return none('This contains an indefinite integral', base);
  const declaredFree = lhs.declared.filter((d) => unknowns.indexOf(d) >= 0);
  if (lhs.declared.length >= 2 && declaredFree.length >= 2 && !complex) {
    return Object.assign(base, { kind: 'surface', xVar: declaredFree[0], yVar: declaredFree[1] });
  }
  if (lhs.declared.length >= 2) return none('This function takes several inputs that do not all appear in the formula', base);
  if (!lhs.declared.length && !complex && unknowns.indexOf('x') >= 0 && unknowns.indexOf('y') >= 0 && lhs.lhsSym !== 'x' && lhs.lhsSym !== 'y') {
    return Object.assign(base, { kind: 'surface', xVar: 'x', yVar: 'y' });
  }
  const usual = AXIS_ORDER.filter((n) => unknowns.indexOf(n) >= 0)[0];
  const variable = declaredFree.length ? declaredFree[0] : (usual || unknowns[0]);
  return Object.assign(base, { kind: complex ? 'complex' : 'curve', variable });
}

function fieldView(ce, m, rhsTex) {
  const declared = m[2] ? m[2].match(NAME_G).map((t) => symbolOf(ce, t.trim())) : [];
  if (declared.some((d) => !d)) return none('The field arguments could not be read');
  let comps = null, unknownSet = new Set();
  const ctx = { fns: new Map() };
  const withUnits = unitVectors(rhsTex);
  if (withUnits !== rhsTex) {
    if (/\\(?:mathbf|boldsymbol|bold|vec|hat|nabla|partial|times|begin)/.test(withUnits)) return none('This vector expression uses notation beyond unit vectors');
    const p = parseExpr(ce, withUnits);
    if (!p.ok) return none('The math engine could not parse this', { json: p.json });
    let f;
    try { f = compileJson(p.json, ctx); } catch (err) { return none(err.message, { json: p.json }); }
    collectSymbols(p.json, unknownSet, ctx);
    ['msI', 'msJ', 'msK'].forEach((s) => unknownSet.delete(s));
    const pick = (I, J, K) => (env) => {
      env.msI = I; env.msJ = J; env.msK = K; const v = f(env);
      env.msI = 0; env.msJ = 0; env.msK = 0; return v - f(env);
    };
    comps = [pick(1, 0, 0), pick(0, 1, 0), pick(0, 0, 1)];
    comps.json = p.json;
    comps.hasK = mentions(p.json, 'msK');
  } else {
    let inner = rhsTex.trim();
    const wrap = /^(?:\\left\s*)?(?:\(|\[|\\langle)([\s\S]*?)(?:\\right\s*)?(?:\)|\]|\\rangle)$/.exec(inner);
    const mat = /^\\begin\s*\{([pbv]?matrix)\}([\s\S]*)\\end\s*\{\1\}$/.exec(inner);
    let pieces = null;
    if (mat) pieces = topSplit(mat[2], isRow);
    else if (wrap) pieces = topSplit(wrap[1], (t, i) => (t[i] === ',' && t[i - 1] !== '\\' ? 1 : 0));
    if (!pieces || pieces.length < 2 || pieces.length > 3) return none('This is not written as components');
    const fs = [], jsons = [];
    for (const piece of pieces) {
      if (NON_SCALAR.test(piece)) return none('A component uses vector or operator notation');
      const p = parseExpr(ce, cleanTex(piece));
      if (!p.ok) return none('A component could not be parsed', { json: p.json });
      try { fs.push(compileJson(p.json, ctx)); } catch (err) { return none(err.message, { json: p.json }); }
      collectSymbols(p.json, unknownSet, ctx); jsons.push(p.json);
    }
    comps = [fs[0], fs[1], fs[2] || (() => 0)];
    comps.json = ['List'].concat(jsons);
    comps.hasK = fs.length === 3;
  }
  const names = ['x', 'y', 'z'];
  const coords = declared.length >= 2 ? declared.slice(0, 3) : names.filter((n) => unknownSet.has(n));
  while (coords.length < 2) { const nxt = names.find((n) => coords.indexOf(n) < 0); coords.push(nxt); }
  const unknowns = Array.from(unknownSet).sort();
  const params = unknowns.filter((u) => coords.indexOf(u) < 0 && u !== 'z');
  if (params.length > 6) return none('This field has too many symbols');
  /* three-dimensional only if the k component is ever non-zero, or z matters */
  let is3d = false;
  if (comps.hasK || unknownSet.has(coords[2] || 'z')) {
    const env = defaultEnv(unknowns.concat(coords));
    for (let i = 0; i < 27 && !is3d; i++) {
      env[coords[0]] = (i % 3) - 1.1; env[coords[1]] = (Math.floor(i / 3) % 3) - 0.9; env[coords[2] || 'z'] = Math.floor(i / 9) - 0.8;
      const k = comps[2](env); if (isFinite(k) && Math.abs(k) > 1e-12) is3d = true;
    }
    if (unknownSet.has(coords[2] || 'z')) is3d = true;
  }
  if (is3d && coords.length < 3) coords.push('z');
  return { kind: is3d ? 'field3d' : 'field2d', comps, coords: is3d ? coords.slice(0, 3) : coords.slice(0, 2), unknowns,
    params: unknowns.filter((u) => coords.indexOf(u) < 0), json: comps.json, lhsLatex: m[1].trim(), ctx };
}

function implicitView(ce, lhsTex, rhsTex) {
  if (NON_SCALAR.test(lhsTex) || NON_SCALAR.test(rhsTex)) return none('This uses vector, matrix or operator notation');
  const a = parseExpr(ce, lhsTex), b = parseExpr(ce, rhsTex);
  if (!a.ok || !b.ok) return none('This is not written as a function');
  const json = ['Subtract', a.json, b.json], ctx = { fns: new Map() };
  if (containsHead(json, ['Sum', 'Product', 'Integrate', 'Limit', 'D', 'Which'])) return none('This states a result');
  const unknowns = Array.from(collectSymbols(json, new Set(), ctx)).sort();
  if (unknowns.indexOf('x') < 0 || unknowns.indexOf('y') < 0) return none('This is not written as a function', { json });
  if (unknowns.length > 6) return none('This has too many symbols', { json });
  let g;
  try { g = compileJson(json, ctx); } catch (err) { return none(err.message, { json }); }
  /* Keep it only if it really describes a curve: the two sides differ, and cross somewhere. */
  const env = { __terms: DEFAULT_TERMS }; unknowns.forEach((u) => { env[u] = 1; });
  let pos = 0, neg = 0, zero = 0, n = 0;
  for (let i = 0; i < 31; i++) for (let k = 0; k < 31; k++) {
    env.x = -6 + 12 * i / 30 + 0.013; env.y = -6 + 12 * k / 30 + 0.007;
    const v = g(env); if (!isFinite(v)) continue; n++;
    if (Math.abs(v) < 1e-9) zero++; else if (v > 0) pos++; else neg++;
  }
  if (n < 50 || zero > n * 0.5) return none('Both sides are always equal, so there is no curve to draw', { json });
  if (!pos || !neg) return none('This equation has no solutions in view', { json });
  return { kind: 'implicit', json, rhsJson: json, unknowns, xVar: 'x', yVar: 'y', lhsLatex: '', ctx };
}

export function classifyPart(ce, tex, table) {
  const segs = eqSplit(tex);
  if (segs.length < 2) return none('This is not an equation');
  const lhsTex = segs[0].trim();
  let m;
  if ((m = VEC_LHS.exec(lhsTex))) {
    let last = none('This vector equation is not written as components');
    for (let k = segs.length - 1; k >= 1; k--) { const v = fieldView(ce, m, cleanTex(segs[k])); if (v.kind !== 'none') return v; last = v; }
    return last;
  }
  let lhs = null;
  if ((m = FN_LHS.exec(lhsTex)) && !BUILTIN_FN.test(m[1])) {
    const argTex = m[2].match(NAME_G).map((t) => t.trim());
    const declared = argTex.map((t) => symbolOf(ce, t));
    if (declared.some((d) => !d)) return none('The function arguments could not be read');
    const key = m[1].replace(/\s+/g, '');
    lhs = { fnTex: m[1].trim(), argTex, declared, lhsLatex: m[1].trim(), lhsSym: null, selfId: table && table.byTex.has(key) ? table.byTex.get(key).id : undefined };
  } else if ((m = SYM_LHS.exec(lhsTex)) && !BUILTIN_FN.test(m[1])) {
    lhs = { fnTex: null, argTex: [], declared: [], lhsLatex: m[1].trim(), lhsSym: symbolOf(ce, m[1]) };
  }
  if (!lhs) {
    if (segs.length === 2) return implicitView(ce, lhsTex, cleanTex(segs[1]));
    return none('This is not written as a function');
  }
  /* a = b = c: prefer the last form that can be computed */
  let last = null;
  for (let k = segs.length - 1; k >= 1; k--) {
    const body = cleanTex(topSplit(segs[k], (t, i) => (t.startsWith('\\approx', i) ? 7 : 0))[0]);
    if (!body) continue;
    const v = scalarView(ce, lhs, body, table);
    if (v.kind !== 'none') return v;
    if (!last || (v.rhsJson && !last.rhsJson)) last = v;
  }
  return last || none('This is not written as a function');
}

const PARAM_CURVE_ORDER = ['t', 'theta', 'phi', 'varphi', 'u', 'v', 's'];
const PARAM_SURF_ORDER = ['theta', 'phi', 'varphi', 'u', 'v', 's', 't', 'z'];
function pickParams(set, order, n) {
  const all = Array.from(set).sort();
  const ranked = order.filter((o) => set.has(o)).concat(all.filter((s) => order.indexOf(s) < 0));
  return ranked.slice(0, n);
}
/* A formula -> the list of things MathScope can draw from it. */
export function analyseFormula(ce, tex, table, partsIn) {
  return scoped(ce, () => analyseFormulaInner(ce, tex, table, partsIn));
}
function analyseFormulaInner(ce, tex, table, partsIn) {
  const parts = partsIn || splitParts(tex);
  const views = [], described = [];
  for (const p of parts) {
    let v;
    try { v = classifyPart(ce, p, table); } catch (err) { v = none('The math engine could not parse this'); }
    v.tex = p;
    described.push(v);
    if (v.kind !== 'none') views.push(v);
  }
  /* x = ..., y = ..., (z = ...) given together describe a curve or a surface */
  const coord = {};
  for (const v of described) if (v.lhsSym && ['x', 'y', 'z'].indexOf(v.lhsSym) >= 0 && v.rhsJson !== undefined && !coord[v.lhsSym]) coord[v.lhsSym] = v;
  if (coord.x && coord.y) {
    const ctx = { fns: table ? table.fns : new Map() }, free = new Set();
    const names = coord.z ? ['x', 'y', 'z'] : ['x', 'y'];
    let ok = true; const fs = [];
    for (const nme of names) {
      collectSymbols(coord[nme].rhsJson, free, ctx);
      try { fs.push(compileJson(coord[nme].rhsJson, ctx)); } catch (err) { ok = false; }
    }
    if (ok && free.size >= 1 && free.size <= 6) {
      const paramLike = PARAM_SURF_ORDER.filter((o) => free.has(o)).length;
      const surface = names.length === 3 && paramLike >= 2;
      const params = surface ? pickParams(free, PARAM_SURF_ORDER, 2) : pickParams(free, PARAM_CURVE_ORDER, 1);
      views.unshift({ kind: surface ? 'psurface' : 'pcurve', dims: names.length, fs, params, unknowns: Array.from(free).sort(),
        json: ['List'].concat(names.map((nme) => coord[nme].rhsJson)), tex: names.map((nme) => coord[nme].tex).join(',\\quad '), lhsLatex: '', ctx });
    }
  }
  return { views, parts: described };
}

/* ------------------------------------------------------------------ display helpers */
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
export function plainSym(s) {
  if (s === '__terms') return 'terms';
  const parts = s.split('_');
  const base = GREEK[parts[0]] || parts[0];
  if (parts.length < 2) return base;
  const sub = parts.slice(1).join('');
  return base + (SUBS[sub] !== undefined ? SUBS[sub] : '_' + sub);
}
export function symLatex(s) {
  if (s === '__terms') return '\\text{terms}';
  const parts = s.split('_');
  const base = GREEK[parts[0]] ? '\\' + parts[0] : (parts[0].length > 1 ? '\\mathrm{' + parts[0] + '}' : parts[0]);
  return parts.length < 2 ? base : base + '_{' + parts.slice(1).map((p) => (GREEK[p] ? '\\' + p : p)).join('') + '}';
}
export function fmt(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = (a !== 0 && (a >= 10000 || a < 0.001)) ? Number(v.toPrecision(3)).toExponential().replace('e+', 'e') : String(Number(v.toPrecision(3)));
  return s.replace('-', '−');
}
export function niceStep(s) {
  const p = Math.pow(10, Math.floor(Math.log10(s))), f = s / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
export const KIND_LABEL = { curve: 'Plot', complex: 'Plot', surface: 'Surface', implicit: 'Curve', field2d: 'Field', field3d: '3D field', pcurve: 'Shape', psurface: '3D shape' };
