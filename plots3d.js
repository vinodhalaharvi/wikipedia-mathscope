/* MathScope WebGL views, drawn with Three.js. Loaded on demand: if this module or
   WebGL is unavailable, the panel falls back to the plain-canvas View3D in plots.js.
   Scenes use the same description as View3D: the unit cube, z pointing up. */
import * as T from './vendor/three/three.bundle.min.js';

const HEIGHT = 340;
function lin(c, k) { return new T.Color().setRGB(c[0] / 255 * (k || 1), c[1] / 255 * (k || 1), c[2] / 255 * (k || 1), T.SRGBColorSpace); }

export class GLView {
  constructor(canvas, wrap, cssVar) {
    this.canvas = canvas; this.wrap = wrap; this.cssVar = cssVar; this.content = []; this.ok = true; this.onLost = null;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });       // throws without WebGL
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(32, 1, 0.1, 60);
    this.camera.up.set(0, 0, 1); this.camera.position.set(3.5, -4.3, 2.8);
    this.scene.add(new T.AmbientLight(0xffffff, 0.95));
    const head = new T.DirectionalLight(0xffffff, 2.4);                                  // a light that travels with the camera
    head.position.set(-0.5, 0.9, 0.6); head.target.position.set(0, 0, -1);
    this.camera.add(head); this.camera.add(head.target); this.scene.add(this.camera);
    this.controls = new T.OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false; this.controls.minDistance = 2.4; this.controls.maxDistance = 14;
    this.controls.addEventListener('change', () => this.render());
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); this.ok = false; if (this.onLost) this.onLost(); });
  }
  clear() {
    for (const o of this.content) {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
    this.content = [];
  }
  add(o) { this.scene.add(o); this.content.push(o); return o; }
  label(text, pos) {
    if (!text) return;
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.font = '600 60px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = this.cssVar('--ink') || '#222';
    g.fillText(text, 128, 48);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.minFilter = T.LinearFilter;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.8, 0.3, 1); sp.position.set(pos[0], pos[1], pos[2]); sp.renderOrder = 10;
    this.add(sp);
  }
  setScene(desc) {
    this.clear();
    const box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(2, 2, 2)), new T.LineBasicMaterial({ color: new T.Color(this.cssVar('--line') || '#ccc') }));
    this.add(box);
    const L = desc.labels || {};
    this.label(L.x, [1.32, -1, -1]); this.label(L.y, [-1, 1.32, -1]); this.label(L.z, [-1, -1, 1.28]);
    const lambert = () => new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });

    if (desc.grid) {                                         // smooth surface from a regular grid of points
      const { nu, nv, points, colors } = desc.grid, pos = [], col = [], idx = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i], ok = p.every((c) => isFinite(c));
        pos.push(ok ? p[0] : 0, ok ? p[1] : 0, ok ? p[2] : 0);
        const c = lin(colors[i]); col.push(c.r, c.g, c.b);
      }
      const fine = (i) => points[i].every((c) => isFinite(c));
      for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
        const a = iv * (nu + 1) + iu, b = a + 1, d = a + nu + 1, c = d + 1;
        if (!fine(a) || !fine(b) || !fine(c) || !fine(d)) continue;
        idx.push(a, b, c, a, c, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      this.add(new T.Mesh(g, lambert()));
    } else {
      const quads = desc.items.filter((it) => it.quad);
      if (quads.length) {
        const pos = [], col = [];
        for (const q of quads) {
          const c = lin(q.color);
          for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q.quad[k][0], q.quad[k][1], q.quad[k][2]); col.push(c.r, c.g, c.b); }
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        this.add(new T.Mesh(g, lambert()));
      }
    }
    if (desc.path && desc.path.length > 2) {                 // a space curve as a tube
      const pts = desc.path.filter((p) => p.every((c) => isFinite(c))).map((p) => new T.Vector3(p[0], p[1], p[2]));
      if (pts.length > 2) {
        const tubular = Math.min(600, pts.length * 2), radial = 10;
        const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts), tubular, 0.022, radial, false), col = [];
        for (let i = 0; i <= tubular; i++) { const c = lin(desc.pathColor(i / tubular)); for (let k = 0; k <= radial; k++) col.push(c.r, c.g, c.b); }
        g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        this.add(new T.Mesh(g, lambert()));
      }
    }
    const arrows = desc.items.filter((it) => it.seg && it.head);
    if (arrows.length) {                                     // solid arrows: one instanced shaft and one instanced head
      const shaftG = new T.CylinderGeometry(0.013, 0.013, 1, 8); shaftG.translate(0, 0.5, 0);
      const headG = new T.ConeGeometry(0.04, 0.1, 12); headG.translate(0, 0.05, 0);
      const mat = () => new T.MeshLambertMaterial({ color: 0xffffff });
      const shafts = new T.InstancedMesh(shaftG, mat(), arrows.length), heads = new T.InstancedMesh(headG, mat(), arrows.length);
      const up = new T.Vector3(0, 1, 0), m = new T.Matrix4(), q = new T.Quaternion();
      arrows.forEach((it, i) => {
        const a = new T.Vector3(...it.seg[0]), b = new T.Vector3(...it.seg[1]), dir = b.clone().sub(a), len = dir.length() || 1e-6;
        dir.divideScalar(len); q.setFromUnitVectors(up, dir);
        const headLen = Math.min(0.1, len * 0.45), shaftLen = len - headLen, c = lin(it.color);
        m.compose(a, q, new T.Vector3(1, shaftLen, 1)); shafts.setMatrixAt(i, m); shafts.setColorAt(i, c);
        const s = headLen / 0.1;
        m.compose(a.clone().addScaledVector(dir, shaftLen), q, new T.Vector3(s, s, s)); heads.setMatrixAt(i, m); heads.setColorAt(i, c);
      });
      shafts.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
      if (shafts.instanceColor) shafts.instanceColor.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      this.add(shafts); this.add(heads);
    }
    this.resize();
  }
  resize() {
    const w = this.wrap.clientWidth;
    if (!w) return;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(w, HEIGHT, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = HEIGHT + 'px';
    this.camera.aspect = w / HEIGHT; this.camera.updateProjectionMatrix();
    this.render();
  }
  render() { if (this.ok) this.renderer.render(this.scene, this.camera); }
}
