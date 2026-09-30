// styles/pixel.js — pixel art. Everything is drawn on a small canvas (default 480×270, i.e. 4× pixels), snapped to a
// limited palette, soft shapes become ordered (Bayer) dithering, then scaled up with hard edges.
// Pure Canvas2D: fast everywhere, no GPU needed.
//
// Project options (project({ pixel: {...} })):
//   scale: 4           size of one art pixel in output pixels (3 → 640×360, 6 → 320×180)
//   palette: [...]     exact colours allowed; default = project palette + a darker and lighter shade of each
//   scanlines: .08     strength of CRT scanlines (0 = off)
//   outline: 1         outline thickness in art pixels
//   dither: 0          0 = clean colour bands; .3–1 = ordered (Bayer) dithering between palette colours

const STYLE = { name: 'pixel', jitter: 0, out: null, ctx: null };
let PX = null;                                     // { s, lw, lh, cv, c, pal, cache }
let _seed = 1;
STYLE.rand = () => { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; };

const hexToRgb = h => { const n = parseInt(h.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function pxInit() {
  const o = PROJ.pixel || {}, s = o.scale || 4, lw = Math.round(W / s), lh = Math.round(H / s);
  const cv = document.createElement('canvas'); cv.width = lw; cv.height = lh; cv.className = 'lowres';
  const c = cv.getContext('2d', { willReadFrequently: true });
  let pal = o.palette;
  if (!pal) {
    const base = Object.values(PROJ.palette).filter(v => typeof v === 'string' && v[0] === '#');
    pal = [];
    for (const b of base) pal.push(b, mixCol(b, '#000000', .35), mixCol(b, '#ffffff', .35));
  }
  PX = { s, lw, lh, cv, c, pal: pal.map(hexToRgb), cache: new Map() };
}
function nearest(r, g, b) {
  const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
  let v = PX.cache.get(key); if (v) return v;
  let best = 0, bd = 1e9;
  for (let i = 0; i < PX.pal.length; i++) { const p = PX.pal[i], d = (p[0] - r) ** 2 * .3 + (p[1] - g) ** 2 * .59 + (p[2] - b) ** 2 * .11; if (d < bd) { bd = d; best = i; } }
  v = PX.pal[best]; PX.cache.set(key, v); return v;
}
function pathOf(pts, smooth) {
  const c = PX.c; c.beginPath();
  if (smooth && pts.length > 2) {
    const n = pts.length, mid = i => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
    let m = mid(n - 1); c.moveTo(m[0], m[1]);
    for (let i = 0; i < n; i++) { const q = mid(i); c.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
  } else { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); }
  c.closePath();
}
const worldPx = () => { const m = PX.c.getTransform(); return Math.hypot(m.a, m.b); };   // art pixels per world unit

// ---------- drawing API ----------
STYLE.bg = col => { const c = PX.c; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = col; c.fillRect(0, 0, PX.lw, PX.lh); c.restore(); };
STYLE.shape = (pts, o) => {
  const c = PX.c, col = o.color || P.ink || '#222', a = o.alpha ?? 1;
  c.fillStyle = col;
  if (o.soft) {                                                  // soft bloom → stepped bands after palette snapping
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (const [k, f] of [[1, .45], [.72, .7], [.45, 1]]) { c.globalAlpha = a * f; pathOf(pts.map(p => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]), o.smooth); c.fill(); }
  } else { c.globalAlpha = a; pathOf(pts, o.smooth); c.fill(); }
  c.globalAlpha = 1;
  if (o.outline) { pathOf(pts, o.smooth); c.strokeStyle = o.outline; c.lineWidth = (PROJ.pixel.outline || 1) * (o.weight ?? 1) / worldPx(); c.lineJoin = 'round'; c.stroke(); }
};
STYLE.stroke = (pts, o) => {
  if (pts.length < 2) return;
  const c = PX.c;
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.globalAlpha = o.alpha ?? 1; c.strokeStyle = o.color || P.ink || '#222';
  c.lineWidth = Math.max(1, Math.round((o.weight ?? 1) * 1.2)) / worldPx(); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.globalAlpha = 1;
};
STYLE.outside = (pts, col) => {
  const c = PX.c; c.save(); c.beginPath(); c.rect(-5000, -5000, W + 10000, H + 10000);
  c.moveTo(pts[0][0], pts[0][1]); for (let i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i][0], pts[i][1]); c.closePath();
  c.fillStyle = col; c.fill('evenodd'); c.restore();
};
STYLE.flash = (k, col) => { const c = PX.c; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = k; c.fillStyle = col; c.fillRect(0, 0, PX.lw, PX.lh); c.restore(); };
STYLE.camBegin = C => { const c = PX.c; c.save(); c.translate(W / 2, H / 2); c.rotate(C.rot); c.scale(C.zoom, C.zoom); c.translate(-C.cx, -C.cy); };
STYLE.camEnd = () => PX.c.restore();
STYLE.drawPlate = p => { const o = p.over; PX.c.imageSmoothingEnabled = false; PX.c.drawImage(p.img, W / 2 - W * o / 2, H / 2 - H * o / 2, W * o, H * o); };
STYLE.gpuInfo = () => 'canvas2d (pixel style needs no GPU)';

function quantize() {
  const id = PX.c.getImageData(0, 0, PX.lw, PX.lh), d = id.data, dz = (PROJ.pixel.dither ?? 0) * 48, lw = PX.lw;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const b = dz ? (BAYER4[(j % lw & 3) + ((Math.floor(j / lw) & 3) << 2)] / 16 - .47) * dz : 0;
    const q = nearest(clamp(d[i] + b, 0, 255) | 0, clamp(d[i + 1] + b, 0, 255) | 0, clamp(d[i + 2] + b, 0, 255) | 0);
    d[i] = q[0]; d[i + 1] = q[1]; d[i + 2] = q[2]; d[i + 3] = 255;
  }
  PX.c.putImageData(id, 0, 0);
}
function beginFrame(t) {
  const c = PX.c; c.setTransform(1 / PX.s, 0, 0, 1 / PX.s, 0, 0); c.imageSmoothingEnabled = false;
  c.fillStyle = PROJ.palette.paper || '#000'; c.fillRect(0, 0, W, H); _seed = boilSeed(t);
}
STYLE.render = async t => {
  beginFrame(t); paintFrame(t);
  PX.c.setTransform(1, 0, 0, 1, 0, 0); drawTexts(PX.c, 1 / PX.s); quantize();
  const o = STYLE.ctx; o.imageSmoothingEnabled = false; o.drawImage(PX.cv, 0, 0, W, H);
  const sl = PROJ.pixel.scanlines ?? .08;
  if (sl > 0) { o.fillStyle = `rgba(0,0,0,${sl})`; for (let y = PX.s - 1; y < H; y += PX.s) o.fillRect(0, y, W, 1); }
};

window.addEventListener('DOMContentLoaded', async () => {
  STYLE.out = document.getElementById('out'); STYLE.ctx = STYLE.out.getContext('2d');
  PROJ.pixel = PROJ.pixel || {}; pxInit(); await document.fonts.ready;
  for (const p of Object.values(PLATES)) {                       // plates: paint once into their own art-pixel canvas
    beginFrame(0); p.fn(); quantize();
    const cv = document.createElement('canvas'); cv.width = PX.lw; cv.height = PX.lh; cv.getContext('2d').drawImage(PX.cv, 0, 0); p.img = cv;
  }
  window.ready = true;
});
