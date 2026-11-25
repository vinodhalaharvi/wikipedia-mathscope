/* MathScope drawing layer: curves, maps (heat + contours + arrows) and a small
   3D renderer, all on a plain 2D canvas so no WebGL or extra library is needed. */
import { fmt, niceStep } from './math.js';

export function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function setup(canvas, wrap, height) {
  const W = wrap.clientWidth, dpr = window.devicePixelRatio || 1;
  if (!W) return null;
  canvas.style.height = height + 'px';
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, height);
  ctx.font = '11px system-ui, sans-serif';
  return { ctx, W, H: height };
}
const LIM = 1e6;

/* ------------------------------------------------------------------ colour */
const SEQ = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]];
const DIV = [[33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43]];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const seqColor = (t) => ramp(SEQ, t);
export const divColor = (t) => ramp(DIV, t);
const rgb = (c, k) => 'rgb(' + Math.round(c[0] * (k || 1)) + ',' + Math.round(c[1] * (k || 1)) + ',' + Math.round(c[2] * (k || 1)) + ')';

/* ------------------------------------------------------------------ curve */
/* opts: { R, xs, series: [{ ys, color, dash }], xLabel, hoverX, hoverVals } ; returns geometry for pointer maths */
export function drawCurve(canvas, wrap, opts) {
  const s = setup(canvas, wrap, 230); if (!s) return null;
  const { ctx, W, H } = s, m = { l: 46, r: 10, t: 10, b: 24 }, pw = W - m.l - m.r, ph = H - m.t - m.b, R = opts.R;
  let lo = 0, hi = 0, any = false;
  const all = [];
  opts.series.forEach((se, k) => { for (const v of se.ys) if (isFinite(v) && Math.abs(v) < LIM) { any = true; if (k === 0) all.push(v); if (v < lo) lo = v; if (v > hi) hi = v; } });
  if (all.length > 20) {                           // a few runaway values should not flatten everything else
    all.sort((p, q) => p - q);
    const q = (t) => all[Math.min(all.length - 1, Math.floor(t * all.length))];
    const a = Math.min(0, q(0.04)), b = Math.max(0, q(0.96)), band = (b - a) || 1;
    if (hi - lo > 6 * band) { lo = Math.max(lo, a - band * 0.6); hi = Math.min(hi, b + band * 0.6); }
  }
  if (lo === hi) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
  if (lo === hi) hi = lo + step;
  const X = (x) => m.l + ((x + R) / (2 * R)) * pw, Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * ph;
  const cGrid = cssVar('--grid'), cMuted = cssVar('--muted'), cInk = cssVar('--ink'), cSurf = cssVar('--surface');
  ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const ny = Math.round((hi - lo) / step);
  for (let k = 0; k <= ny; k++) {
    const yv = lo + k * step, py = Math.round(Y(yv)) + 0.5, zero = Math.abs(yv) < step * 1e-6;
    ctx.strokeStyle = zero ? cMuted : cGrid; ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.stroke();
    ctx.fillStyle = cMuted; ctx.fillText(fmt(zero ? 0 : yv), m.l - 6, py);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let t = -3; t <= 3; t++) {
    const xv = (t * R) / 3, px = Math.round(X(xv)) + 0.5;
    if (t === 0) { ctx.strokeStyle = cMuted; ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke(); }
    ctx.fillStyle = cMuted; ctx.fillText(fmt(xv), px, m.t + ph + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = cInk; ctx.fillText(opts.xLabel, m.l + pw - 2, m.t + ph - 4);
  if (!any) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = cMuted;
    ctx.fillText('No real values with these settings.', m.l + pw / 2, m.t + ph / 2);
    return { m, pw, R };
  }
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
  for (let k = opts.series.length - 1; k >= 0; k--) {
    const se = opts.series[k];
    ctx.strokeStyle = se.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.setLineDash(se.dash || []); ctx.beginPath();
    let pen = false, prev = 0;
    for (let i = 0; i < se.ys.length; i++) {
      const v = se.ys[i];
      if (!isFinite(v) || Math.abs(v) >= LIM) { pen = false; continue; }
      const px = X(opts.xs[i]), py = Y(v);
      if (pen && Math.abs(py - prev) > ph * 1.5) pen = false;          // a jump: do not join across it
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
      prev = py;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (opts.hoverX !== null && opts.hoverX !== undefined) {
    const cx = Math.round(X(opts.hoverX)) + 0.5;
    ctx.strokeStyle = cMuted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph); ctx.stroke();
    opts.series.forEach((se, k) => {
      const v = opts.hoverVals[k]; if (!isFinite(v)) return;
      ctx.beginPath(); ctx.arc(X(opts.hoverX), Y(v), 5, 0, Math.PI * 2); ctx.fillStyle = se.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = cSurf; ctx.stroke();
    });
  }
  ctx.restore();
  return { m, pw, R };
}

/* ------------------------------------------------------------------ map */
function marching(ctx, g, N, level, X, Y) {
  /* g: (N+1)x(N+1) values row-major [iy][ix]; X(ix), Y(iy) -> pixels */
  const lerp = (a, b) => (level - a) / (b - a);
  ctx.beginPath();
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const a = g[iy * (N + 1) + ix], b = g[iy * (N + 1) + ix + 1], c = g[(iy + 1) * (N + 1) + ix + 1], d = g[(iy + 1) * (N + 1) + ix];
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) continue;
    const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const pts = [];
    if ((code & 1) !== ((code >> 1) & 1)) pts.push([X(ix + lerp(a, b)), Y(iy)]);
    if (((code >> 1) & 1) !== ((code >> 2) & 1)) pts.push([X(ix + 1), Y(iy + lerp(b, c))]);
    if (((code >> 2) & 1) !== ((code >> 3) & 1)) pts.push([X(ix + 1 - lerp(c, d)), Y(iy + 1)]);
    if (((code >> 3) & 1) !== (code & 1)) pts.push([X(ix), Y(iy + 1 - lerp(d, a))]);
    for (let k = 0; k + 1 < pts.length; k += 2) { ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k + 1][0], pts[k + 1][1]); }
  }
  ctx.stroke();
}
/* opts: { R, value(x, y) | null, diverging, zeroOnly, vector(x, y) -> [u, v] | null, xLabel, yLabel, hover: [x, y] | null }
   returns { toData(clientX, clientY), lo, hi } */
export function drawMap(canvas, wrap, opts) {
  const wide = wrap.clientWidth;
  const side = Math.max(160, Math.min(wide - 46 - 58, 300));
  const s = setup(canvas, wrap, side + 40); if (!s) return null;
  const { ctx } = s, m = { l: 46, t: 10 }, R = opts.R, N = 72;
  const cGrid = cssVar('--grid'), cMuted = cssVar('--muted'), cInk = cssVar('--ink'), cAcc = cssVar('--series-1');
  const X = (ix) => m.l + (ix / N) * side, Y = (iy) => m.t + side - (iy / N) * side;
  let lo = Infinity, hi = -Infinity, g = null;
  if (opts.value) {
    g = new Float64Array((N + 1) * (N + 1));
    for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) {
      const v = opts.value(-R + (2 * R * ix) / N, -R + (2 * R * iy) / N);
      g[iy * (N + 1) + ix] = v;
      if (isFinite(v) && Math.abs(v) < LIM) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const finite = lo <= hi;
  if (opts.diverging && finite) { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -a; hi = a; }
  if (finite && lo === hi) { lo -= 0.5; hi += 0.5; }
  ctx.fillStyle = cssVar('--bg'); ctx.fillRect(m.l, m.t, side, side);
  if (g && finite && !opts.zeroOnly) {
    const off = document.createElement('canvas'); off.width = N + 1; off.height = N + 1;
    const octx = off.getContext('2d'), img = octx.createImageData(N + 1, N + 1);
    for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) {
      const v = g[iy * (N + 1) + ix], o = ((N - iy) * (N + 1) + ix) * 4;
      if (!isFinite(v)) { img.data[o + 3] = 0; continue; }
      const c = (opts.diverging ? divColor : seqColor)((v - lo) / (hi - lo));
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0.5, 0.5, N, N, m.l, m.t, side, side);
    if (!opts.vector) {
      const step = niceStep((hi - lo) / 7);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      for (let lv = Math.ceil(lo / step + 1e-6) * step; lv < hi - step * 1e-6; lv += step) marching(ctx, g, N, lv, X, Y);
    }
  }
  /* grid lines and ticks */
  ctx.lineWidth = 1; ctx.fillStyle = cMuted;
  for (let t = -3; t <= 3; t++) {
    const v = (t * R) / 3, px = Math.round(m.l + ((v + R) / (2 * R)) * side) + 0.5, py = Math.round(m.t + side - ((v + R) / (2 * R)) * side) + 0.5;
    if (opts.zeroOnly || !g) { ctx.strokeStyle = t === 0 ? cMuted : cGrid; ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + side); ctx.moveTo(m.l, py); ctx.lineTo(m.l + side, py); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmt(v), px, m.t + side + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmt(v), m.l - 6, py);
  }
  ctx.fillStyle = cInk; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(opts.xLabel, m.l + side, m.t + side + 20);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(opts.yLabel, 4, m.t);
  if (g && opts.zeroOnly) { ctx.lineWidth = 2.5; ctx.strokeStyle = cAcc; ctx.lineJoin = 'round'; marching(ctx, g, N, 0, X, Y); }
  if (opts.vector) {
    const K = 15, cell = side / K; let maxMag = 0; const vs = [];
    for (let iy = 0; iy < K; iy++) for (let ix = 0; ix < K; ix++) {
      const x = -R + (2 * R * (ix + 0.5)) / K, y = -R + (2 * R * (iy + 0.5)) / K, v = opts.vector(x, y), mag = Math.hypot(v[0], v[1]);
      vs.push([ix, iy, v[0], v[1], mag]); if (isFinite(mag) && mag > maxMag) maxMag = mag;
    }
    ctx.strokeStyle = cInk; ctx.fillStyle = cInk; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (const [ix, iy, u, v, mag] of vs) {
      if (!isFinite(mag) || mag === 0 || maxMag === 0) continue;
      const len = cell * 0.82 * Math.sqrt(mag / maxMag), ux = u / mag, uy = -v / mag;
      const cx = m.l + (ix + 0.5) * cell, cy = m.t + side - (iy + 0.5) * cell;
      const x0 = cx - ux * len / 2, y0 = cy - uy * len / 2, x1 = cx + ux * len / 2, y1 = cy + uy * len / 2, hd = Math.min(5, len * 0.45);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = '#16181d'; ctx.fillStyle = '#16181d'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * hd - uy * hd * 0.55, y1 - uy * hd + ux * hd * 0.55); ctx.lineTo(x1 - ux * hd + uy * hd * 0.55, y1 - uy * hd - ux * hd * 0.55); ctx.closePath(); ctx.fill();
    }
  }
  if (g && finite && !opts.zeroOnly) {                         // colour scale
    const bx = m.l + side + 12, bw = 10;
    for (let i = 0; i < side; i++) { ctx.fillStyle = rgb((opts.diverging ? divColor : seqColor)(1 - i / (side - 1))); ctx.fillRect(bx, m.t + i, bw, 1.5); }
    ctx.fillStyle = cMuted; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(fmt(hi), bx + bw + 4, m.t);
    ctx.textBaseline = 'bottom'; ctx.fillText(fmt(lo), bx + bw + 4, m.t + side);
    if (opts.diverging) { ctx.textBaseline = 'middle'; ctx.fillText('0', bx + bw + 4, m.t + side / 2); }
  }
  if (!finite && opts.value) { ctx.fillStyle = cMuted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('No real values with these settings.', m.l + side / 2, m.t + side / 2); }
  if (opts.hover) {
    const hx = m.l + ((opts.hover[0] + R) / (2 * R)) * side, hy = m.t + side - ((opts.hover[1] + R) / (2 * R)) * side;
    ctx.strokeStyle = cInk; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx - 7, hy); ctx.lineTo(hx + 7, hy); ctx.moveTo(hx, hy - 7); ctx.lineTo(hx, hy + 7); ctx.stroke();
  }
  ctx.strokeStyle = cGrid; ctx.lineWidth = 1; ctx.strokeRect(m.l + 0.5, m.t + 0.5, side, side);
  return { lo, hi, toData(clientX, clientY) {
    const r = canvas.getBoundingClientRect(), tx = (clientX - r.left - m.l) / side, ty = 1 - (clientY - r.top - m.t) / side;
    if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return null;
    return [Math.round((-R + tx * 2 * R) * 100) / 100, Math.round((-R + ty * 2 * R) * 100) / 100];
  } };
}

/* ------------------------------------------------------------------ 3D */
/* A scene is a list of primitives in the unit cube [-1, 1]^3:
     { quad: [p0, p1, p2, p3], color: [r, g, b] }      filled, shaded
     { seg: [p0, p1], color: [r, g, b], width, head }  line, optional arrow head
   plus box labels. Drawn back to front (painter's algorithm). */
export class View3D {
  constructor(canvas, wrap, onChange) {
    this.canvas = canvas; this.wrap = wrap; this.yaw = -0.65; this.pitch = 0.5; this.scene = null; this.drag = null; this.active = false;
    canvas.addEventListener('pointerdown', (ev) => { if (!this.active) return; this.drag = [ev.clientX, ev.clientY, this.yaw, this.pitch]; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.active || !this.drag) return;
      this.yaw = this.drag[2] + (ev.clientX - this.drag[0]) * 0.01;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.drag[3] + (ev.clientY - this.drag[1]) * 0.01));
      this.draw(); if (onChange) onChange();
    });
    const end = () => { this.drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }
  setScene(scene) { this.scene = scene; this.draw(); }
  project(p, cx, cy, sc) {
    const ca = Math.cos(this.yaw), sa = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const xr = p[0] * ca - p[1] * sa, yr = p[0] * sa + p[1] * ca;
    return [cx + sc * xr, cy - sc * (p[2] * cp + yr * sp), yr * cp - p[2] * sp];
  }
  draw() {
    if (!this.scene) return;
    const s = setup(this.canvas, this.wrap, 320); if (!s) return;
    const { ctx, W, H } = s, cx = W / 2, cy = H / 2 + 4, sc = Math.min(W, H) * 0.33;
    const P = (p) => this.project(p, cx, cy, sc);
    const cGrid = cssVar('--grid'), cMuted = cssVar('--muted'), cInk = cssVar('--ink');
    const items = [];
    const B = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => {
      const pa = P(B[a]), pb = P(B[b]); items.push({ d: (pa[2] + pb[2]) / 2 + 0.02, box: [pa, pb] });
    });
    for (const it of this.scene.items) {
      if (it.quad) { const q = it.quad.map(P); items.push({ d: (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4, quad: q, color: it.color, shade: it.shade }); }
      else { const a = P(it.seg[0]), b = P(it.seg[1]); items.push({ d: (a[2] + b[2]) / 2, seg: [a, b], color: it.color, width: it.width || 1.6, head: it.head }); }
    }
    items.sort((p, q) => q.d - p.d);
    for (const it of items) {
      if (it.box) { ctx.strokeStyle = cGrid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(it.box[0][0], it.box[0][1]); ctx.lineTo(it.box[1][0], it.box[1][1]); ctx.stroke(); }
      else if (it.quad) {
        const q = it.quad;
        ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]); ctx.closePath();
        ctx.fillStyle = rgb(it.color, it.shade === undefined ? 1 : it.shade); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 0.5; ctx.stroke();
      } else {
        const [a, b] = it.seg;
        ctx.strokeStyle = rgb(it.color); ctx.fillStyle = rgb(it.color); ctx.lineWidth = it.width; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (it.head) {
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
          if (len > 2) { const ux = dx / len, uy = dy / len, hd = Math.min(6, len * 0.5);
            ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - ux * hd - uy * hd * 0.5, b[1] - uy * hd + ux * hd * 0.5); ctx.lineTo(b[0] - ux * hd + uy * hd * 0.5, b[1] - uy * hd - ux * hd * 0.5); ctx.closePath(); ctx.fill(); }
        }
      }
    }
    /* axis labels at the ends of the three axes through the near-bottom corner */
    const L = this.scene.labels || {};
    ctx.fillStyle = cInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
    const lab = (p, text) => { if (!text) return; const q = P(p); ctx.fillText(text, q[0], q[1]); };
    lab([1.22, -1, -1], L.x); lab([-1, 1.22, -1], L.y); lab([-1, -1, 1.2], L.z);
    ctx.fillStyle = cMuted; ctx.font = '11px system-ui, sans-serif';
    if (L.range) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(L.range, 6, H - 6); }
  }
}

/* ------------------------------------------------------------------ scene builders */
export function surfaceScene(value, R, labels, res) {
  const N = res || 34, z = new Float64Array((N + 1) * (N + 1)); let lo = Infinity, hi = -Infinity;
  for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) {
    const v = value(-R + (2 * R * ix) / N, -R + (2 * R * iy) / N); z[iy * (N + 1) + ix] = v;
    if (isFinite(v) && Math.abs(v) < LIM) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const items = []; let grid = null;
  if (lo <= hi) {
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const Z = (v) => -0.75 + 1.5 * (v - lo) / (hi - lo), U = (i) => -1 + (2 * i) / N;
    grid = { nu: N, nv: N, points: [], colors: [] };
    for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) { const v = z[iy * (N + 1) + ix], ok = isFinite(v) && Math.abs(v) < LIM; grid.points.push([U(ix), U(iy), ok ? Z(v) : NaN]); grid.colors.push(seqColor(ok ? (v - lo) / (hi - lo) : 0)); }
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const a = z[iy * (N + 1) + ix], b = z[iy * (N + 1) + ix + 1], c = z[(iy + 1) * (N + 1) + ix + 1], d = z[(iy + 1) * (N + 1) + ix];
      if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) continue;
      const mean = (a + b + c + d) / 4;
      items.push({ quad: [[U(ix), U(iy), Z(a)], [U(ix + 1), U(iy), Z(b)], [U(ix + 1), U(iy + 1), Z(c)], [U(ix), U(iy + 1), Z(d)]], color: seqColor((mean - lo) / (hi - lo)) });
    }
  }
  return { items, grid, labels: Object.assign({ range: lo <= hi ? 'height ' + fmt(lo) + ' to ' + fmt(hi) : 'No real values with these settings.' }, labels), lo, hi };
}
export function parametricSurfaceScene(point, ranges, labels, res) {
  const NU = res ? res[0] : 40, NV = res ? res[1] : 28, pts = []; let ext = 0;
  for (let iv = 0; iv <= NV; iv++) for (let iu = 0; iu <= NU; iu++) {
    const p = point(ranges[0][0] + (ranges[0][1] - ranges[0][0]) * iu / NU, ranges[1][0] + (ranges[1][1] - ranges[1][0]) * iv / NV);
    pts.push(p); for (const c of p) if (isFinite(c) && Math.abs(c) < LIM) ext = Math.max(ext, Math.abs(c));
  }
  const items = []; ext = ext || 1;
  const n = (p) => [p[0] / ext * 0.95, p[1] / ext * 0.95, p[2] / ext * 0.95];
  for (let iv = 0; iv < NV; iv++) for (let iu = 0; iu < NU; iu++) {
    const q = [pts[iv * (NU + 1) + iu], pts[iv * (NU + 1) + iu + 1], pts[(iv + 1) * (NU + 1) + iu + 1], pts[(iv + 1) * (NU + 1) + iu]];
    if (q.some((p) => p.some((c) => !isFinite(c)))) continue;
    const a = n(q[0]), b = n(q[1]), d = n(q[3]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(nx, ny, nz) || 1;
    const light = Math.abs((nx * 0.35 + ny * -0.5 + nz * 0.8) / nl);
    const zm = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 / ext;
    items.push({ quad: q.map(n), color: seqColor(0.12 + 0.8 * (zm + 1) / 2), shade: 0.62 + 0.38 * light });
  }
  const grid = { nu: NU, nv: NV, points: pts.map(n), colors: pts.map((p) => seqColor(0.12 + 0.8 * ((isFinite(p[2]) ? p[2] / ext : 0) + 1) / 2)) };
  return { items, grid, labels: Object.assign({ range: 'extent ±' + fmt(ext) }, labels) };
}
export function spaceCurveScene(point, range, labels) {
  const N = 400, pts = [], ext = [0, 0, 0];
  for (let i = 0; i <= N; i++) { const p = point(range[0] + (range[1] - range[0]) * i / N); pts.push(p); p.forEach((c, k) => { if (isFinite(c) && Math.abs(c) < LIM) ext[k] = Math.max(ext[k], Math.abs(c)); }); }
  /* each axis is scaled on its own, so a tall thin curve still fills the box */
  const sc = ext.map((e) => e || 1), items = [];
  const n = (p) => p.map((c, k) => c / sc[k] * 0.9);
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.concat(b).some((c) => !isFinite(c))) continue;
    items.push({ seg: [n(a), n(b)], color: seqColor(0.1 + 0.8 * i / N), width: 2.2 });
  }
  return { items, path: pts.map(n), pathColor: (t) => seqColor(0.1 + 0.8 * t), labels: Object.assign({ range: 'x ±' + fmt(sc[0]) + ', y ±' + fmt(sc[1]) + ', z ±' + fmt(sc[2]) }, labels) };
}
export function fieldScene(vector, R, labels) {
  const K = 5, vs = []; let maxMag = 0;
  for (let iz = 0; iz < K; iz++) for (let iy = 0; iy < K; iy++) for (let ix = 0; ix < K; ix++) {
    const u = [-0.8 + 1.6 * ix / (K - 1), -0.8 + 1.6 * iy / (K - 1), -0.8 + 1.6 * iz / (K - 1)];
    const v = vector(u[0] * R, u[1] * R, u[2] * R), mag = Math.hypot(v[0], v[1], v[2]);
    vs.push([u, v, mag]); if (isFinite(mag) && mag > maxMag) maxMag = mag;
  }
  const items = [];
  for (const [u, v, mag] of vs) {
    if (!isFinite(mag) || mag === 0 || maxMag === 0) continue;
    const len = 0.34 * Math.sqrt(mag / maxMag), d = v.map((c) => c / mag * len / 2);
    items.push({ seg: [[u[0] - d[0], u[1] - d[1], u[2] - d[2]], [u[0] + d[0], u[1] + d[1], u[2] + d[2]]], color: seqColor(0.1 + 0.8 * mag / maxMag), width: 1.8, head: true });
  }
  return { items, labels: Object.assign({ range: maxMag ? 'strongest arrow ' + fmt(maxMag) : 'The field is zero everywhere here.' }, labels), maxMag };
}

/* ------------------------------------------------------------------ flat parametric curve */
export function drawPath(canvas, wrap, pts, labels) {
  const wide = wrap.clientWidth, side = Math.max(160, Math.min(wide - 46 - 12, 300));
  const s = setup(canvas, wrap, side + 40); if (!s) return;
  const { ctx } = s, m = { l: 46, t: 10 };
  const cGrid = cssVar('--grid'), cMuted = cssVar('--muted'), cInk = cssVar('--ink');
  let ext = 0;
  for (const p of pts) for (const c of p) if (isFinite(c) && Math.abs(c) < LIM) ext = Math.max(ext, Math.abs(c));
  ext = ext || 1;
  const step = niceStep(ext / 2.5), R = Math.ceil(ext / step - 1e-9) * step;
  const X = (x) => m.l + ((x + R) / (2 * R)) * side, Y = (y) => m.t + side - ((y + R) / (2 * R)) * side;
  ctx.lineWidth = 1;
  for (let v = -R; v <= R + 1e-9; v += step) {
    const px = Math.round(X(v)) + 0.5, py = Math.round(Y(v)) + 0.5, zero = Math.abs(v) < step * 1e-6;
    ctx.strokeStyle = zero ? cMuted : cGrid; ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + side); ctx.moveTo(m.l, py); ctx.lineTo(m.l + side, py); ctx.stroke();
    ctx.fillStyle = cMuted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmt(zero ? 0 : v), px, m.t + side + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmt(zero ? 0 : v), m.l - 6, py);
  }
  ctx.fillStyle = cInk; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(labels.x, m.l + side, m.t + side + 20);
  ctx.textAlign = 'left'; ctx.fillText(labels.y, 4, m.t);
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, side, side); ctx.clip();
  ctx.strokeStyle = cssVar('--series-1'); ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!isFinite(p[0]) || !isFinite(p[1])) { pen = false; continue; }
    if (pen) ctx.lineTo(X(p[0]), Y(p[1])); else { ctx.moveTo(X(p[0]), Y(p[1])); pen = true; }
  }
  ctx.stroke(); ctx.restore();
}
