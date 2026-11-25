/* MathScope operators: things that take one drawable object and return another.

     curve    --derivative, integral, Fourier spectrum, Taylor-->  curve
     surface  --gradient-->   field        surface --Laplacian--> surface
     field    --divergence--> surface      field   --curl-->      surface (2D) or field (3D)

   Every object is described by a MathJSON tree, so results can be fed to the next
   operator. Derivatives are taken symbolically by the engine when the tree allows
   it; otherwise the tree is wrapped in a numeric node (NumD, NumInt) that the
   evaluator in math.js understands. Numeric derivatives of numeric derivatives are
   never nested: the order is raised on one node, which keeps them accurate. */
import { compileJson, collectSymbols, containsHead, substitute, scoped, infiniteSum, symLatex } from './math.js';

const NUMERIC_HEADS = ['Sum', 'Product', 'Integrate', 'Which', 'NumD', 'NumInt', 'Taylor', 'Abs', 'Floor', 'Ceil', 'Sign', 'Min', 'Max', 'Mod'];
const BAD_RESULT = ['D', 'Derivative', 'PartialDerivative', 'Error', 'Integrate', 'Limit'];
const MAX_NUMERIC_ORDER = 4;

function usesCustom(j, ctx) {
  if (!Array.isArray(j)) return false;
  if (ctx && ctx.fns && ctx.fns.has(j[0])) return true;
  for (let i = 1; i < j.length; i++) if (usesCustom(j[i], ctx)) return true;
  return false;
}
function compiles(json, ctx) { try { compileJson(json, ctx); return true; } catch (err) { return false; } }

/* d/dv of a tree. Returns { json, symbolic } or null when no further derivative is available. */
export function differentiate(engine, json, v, ctx) {
  if (typeof json === 'number') return { json: 0, symbolic: true };
  if (!containsHead(json, NUMERIC_HEADS) && !usesCustom(json, ctx)) {
    try {
      const out = scoped(engine, () => engine.box(['D', json, v]).evaluate().simplify().json);
      if (!containsHead(out, BAD_RESULT) && JSON.stringify(out).indexOf('"Error"') < 0 && compiles(out, ctx)) return { json: out, symbolic: true };
    } catch (err) { /* fall through to numbers */ }
  }
  if (Array.isArray(json) && json[0] === 'NumD' && json[2] === v) {
    if ((json[3] || 1) >= MAX_NUMERIC_ORDER) return null;
    return { json: ['NumD', json[1], v, (json[3] || 1) + 1], symbolic: false };
  }
  return { json: ['NumD', json, v, 1], symbolic: false };
}
function tidy(engine, json, ctx) {
  try {
    const out = scoped(engine, () => engine.box(json).simplify().json);
    if (!containsHead(out, BAD_RESULT) && compiles(out, ctx)) return out;
  } catch (err) { /* keep the untidied tree */ }
  return json;
}
export function toLatex(engine, json) {
  if (containsHead(json, ['NumD', 'NumInt', 'Taylor'])) return '';
  if (/"msfn/.test(JSON.stringify(json))) return '';
  try {
    const tex = scoped(engine, () => engine.box(json).latex);
    return tex.length > 600 ? '' : tex.replace(/\\mathrm\{(varphi|gamma)\}/g, '\\$1');
  } catch (err) { return ''; }
}

function nameOf(view) { return view.nameLatex || view.fnTex || view.lhsLatex || 'f'; }
function symbolsOf(trees, ctx) {
  const set = new Set();
  trees.forEach((t) => collectSymbols(t, set, ctx));
  return Array.from(set).sort();
}
function scalar(kind, engine, base, json, symbolic, extra) {
  const ctx = base.ctx, name = extra.nameLatex;
  const formula = symbolic ? toLatex(engine, json) : '';
  return Object.assign({
    kind, json, rhsJson: json, ctx, derived: true, fnTex: null, declared: [], lhsSym: null, lhsLatex: name,
    unknowns: symbolsOf([json], ctx), usesTerms: infiniteSum(json), numericOnly: !symbolic,
    tex: formula ? name + ' = ' + formula : name, symbolic
  }, extra);
}
function field(kind, engine, base, trees, coords, symbolic, extra) {
  const ctx = base.ctx, name = extra.nameLatex;
  const comps = trees.map((t) => compileJson(t, ctx));
  while (comps.length < 3) comps.push(() => 0);
  const unknowns = symbolsOf(trees, ctx);
  const parts = symbolic ? trees.map((t) => toLatex(engine, t)) : [];
  const formula = parts.length && parts.every((p) => p) ? '\\left(' + parts.join(',\\; ') + '\\right)' : '';
  return Object.assign({
    kind, comps, compJson: trees, coords, json: ['List'].concat(trees), ctx, derived: true, lhsLatex: name,
    unknowns, params: unknowns.filter((u) => coords.indexOf(u) < 0), tex: formula ? name + ' = ' + formula : name, symbolic
  }, extra);
}

/* Which operators apply to a view. `axes` are the symbols currently on the axes. */
export function operatorsFor(view) {
  if (view.kind === 'curve') {
    const ops = [{ id: 'derivative', label: 'Derivative' }, { id: 'integral', label: 'Integral' }, { id: 'fourier', label: 'Fourier spectrum' }];
    if (!containsHead(view.rhsJson, ['Taylor'])) ops.push({ id: 'taylor', label: 'Taylor approximation' });
    return ops;
  }
  if (view.kind === 'surface') return [{ id: 'gradient', label: 'Gradient' }, { id: 'laplacian', label: 'Laplacian' }];
  if ((view.kind === 'field2d' || view.kind === 'field3d') && view.compJson) return [{ id: 'divergence', label: 'Divergence' }, { id: 'curl', label: 'Curl' }];
  return [];
}

function freshSymbol(taken, candidates) { return candidates.find((c) => taken.indexOf(c) < 0) || candidates[candidates.length - 1] + '_1'; }

/* Apply one operator. Returns the new view, or { error } with a sentence for the user. */
export function applyOperator(engine, view, id, axes) {
  const ctx = view.ctx, name = nameOf(view);
  if (view.kind === 'curve') {
    const x = axes[0], json = view.rhsJson, xl = symLatex(x);
    if (id === 'derivative') {
      const d = differentiate(engine, json, x, ctx);
      if (!d) return { error: 'A fifth numerical derivative would be mostly rounding noise, so MathScope stops at four.' };
      return scalar('curve', engine, view, d.json, d.symbolic, { variable: x, declared: [x], title: 'Derivative', nameLatex: '\\frac{d}{d' + xl + '}\\left[' + name + '\\right]',
        note: d.symbolic ? '' : 'Estimated numerically.' });
    }
    if (id === 'integral') {
      const t = 'ms_t';
      const tree = ['NumInt', substitute(json, { [x]: t }), t, 0, x, 120];
      return scalar('curve', engine, view, tree, false, { variable: x, declared: [x], title: 'Integral', nameLatex: '\\int_{0}^{' + xl + '}' + name + '\\,d' + xl,
        note: 'Area from 0 up to each point, added up numerically.' });
    }
    if (id === 'fourier') {
      const t = 'ms_t', w = freshSymbol(view.unknowns, ['omega', 'k', 'xi', 'nu']);
      const body = substitute(json, { [x]: t });
      const part = (trig) => ['Power', ['NumInt', ['Multiply', body, [trig, ['Multiply', w, t]]], t, -10, 10, 600], 2];
      const tree = ['Sqrt', ['Add', part('Cos'), part('Sin')]];
      return scalar('curve', engine, view, tree, false, { variable: w, declared: [w], heavy: true, title: 'Fourier spectrum', nameLatex: '\\left|\\mathcal{F}\\left[' + name + '\\right]\\right|',
        note: 'How strongly each frequency is present. Computed from the function between −10 and 10.' });
    }
    if (id === 'taylor') {
      const list = [json]; let symbolic = true;
      for (let k = 1; k <= 8; k++) {
        const d = differentiate(engine, list[list.length - 1], x, ctx);
        if (!d) break;
        if (!d.symbolic) symbolic = false;
        list.push(d.json);
        if (!symbolic && k >= MAX_NUMERIC_ORDER) break;
      }
      const top = list.length - 1;
      const tree = ['Taylor', ['List'].concat(list), x];
      return scalar('curve', engine, view, tree, false, { variable: x, declared: [x], refJson: json, title: 'Taylor approximation', nameLatex: 'T\\left[' + name + '\\right]',
        special: [{ name: '__order', min: 0, max: top, step: 1, value: Math.min(3, top) }, { name: '__center', min: -5, max: 5, step: 0.05, value: 0 }],
        note: 'A polynomial that matches the function at the centre. Raise the order to hug it further out.' + (symbolic ? '' : ' Limited to order ' + top + ' here, because the derivatives are numerical.') });
    }
  }
  if (view.kind === 'surface') {
    const [x, y] = axes, json = view.rhsJson;
    const dx = differentiate(engine, json, x, ctx), dy = differentiate(engine, json, y, ctx);
    if (id === 'gradient') {
      return field('field2d', engine, view, [dx.json, dy.json], [x, y], dx.symbolic && dy.symbolic, { title: 'Gradient', nameLatex: '\\nabla ' + name,
        note: 'Arrows point uphill on the surface; longer arrows mean steeper.' });
    }
    if (id === 'laplacian') {
      const dxx = differentiate(engine, dx.json, x, ctx), dyy = differentiate(engine, dy.json, y, ctx);
      if (!dxx || !dyy) return { error: 'This surface has already been differentiated numerically too many times to go further.' };
      const symbolic = dxx.symbolic && dyy.symbolic;
      const tree = symbolic ? tidy(engine, ['Add', dxx.json, dyy.json], ctx) : ['Add', dxx.json, dyy.json];
      return scalar('surface', engine, view, tree, symbolic, { xVar: x, yVar: y, title: 'Laplacian', nameLatex: '\\nabla^{2} ' + name,
        note: 'Positive where the surface is a dip, negative where it is a bump.' });
    }
  }
  if (view.kind === 'field2d' || view.kind === 'field3d') {
    const c = view.coords, T = view.compJson, three = view.kind === 'field3d';
    const d = (i, k) => differentiate(engine, T[i], c[k], ctx);
    if (id === 'divergence') {
      const parts = (three ? [0, 1, 2] : [0, 1]).map((i) => d(i, i));
      if (parts.some((p) => !p)) return { error: 'This field has already been differentiated numerically too many times to go further.' };
      const symbolic = parts.every((p) => p.symbolic);
      const sum = ['Add'].concat(parts.map((p) => p.json));
      return scalar('surface', engine, view, symbolic ? tidy(engine, sum, ctx) : sum, symbolic, { xVar: c[0], yVar: c[1], title: 'Divergence', nameLatex: '\\nabla\\cdot ' + name,
        note: 'Positive where the field spreads out, negative where it gathers.' + (three ? ' Shown on a flat slice; the third coordinate is a slider.' : '') });
    }
    if (id === 'curl') {
      if (!three) {
        const a = d(1, 0), b = d(0, 1);
        if (!a || !b) return { error: 'This field has already been differentiated numerically too many times to go further.' };
        const symbolic = a.symbolic && b.symbolic, diff = ['Subtract', a.json, b.json];
        return scalar('surface', engine, view, symbolic ? tidy(engine, diff, ctx) : diff, symbolic, { xVar: c[0], yVar: c[1], title: 'Curl', nameLatex: '\\nabla\\times ' + name,
          note: 'Positive where the field turns anticlockwise, negative where it turns clockwise.' });
      }
      const pairs = [[2, 1, 1, 2], [0, 2, 2, 0], [1, 0, 0, 1]].map(([i, k, m, n]) => [d(i, k), d(m, n)]);
      if (pairs.some((p) => !p[0] || !p[1])) return { error: 'This field has already been differentiated numerically too many times to go further.' };
      const symbolic = pairs.every((p) => p[0].symbolic && p[1].symbolic);
      const trees = pairs.map((p) => { const t = ['Subtract', p[0].json, p[1].json]; return symbolic ? tidy(engine, t, ctx) : t; });
      return field('field3d', engine, view, trees, c.slice(0, 3), symbolic, { title: 'Curl', nameLatex: '\\nabla\\times ' + name,
        note: 'Each arrow is the axis the field spins around at that point.' });
    }
  }
  return { error: 'That operator does not apply here.' };
}
