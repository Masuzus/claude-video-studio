// core.js — style-agnostic animation core for claude-video-studio.
//
// A project is a set of shots. Each shot is a pure function of time that paints the WHOLE frame through the
// drawing API below. The active style (engine/styles/<name>.js) decides what the drawing calls look like
// (watercolor, ink, pixel, ...), so the same scenes can be rendered in any style.
//
// World space is always 1920×1080, origin top-left, y down. Frames render in parallel and out of order:
// never keep state between frames, never call Math.random() — use hash(i) and jit(a).

const W = 1920, H = 1080, TAU = Math.PI * 2;

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const frac = x => x - Math.floor(x);
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeIn = x => Math.pow(clamp(x), 3);
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const backOut = x => { x = clamp(x); const s = 1.9; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
const elasticOut = x => { x = clamp(x); return x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * (TAU / 3)) + 1; };
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const wob = (t, f = 1, ph = 0) => Math.sin((t * f + ph) * TAU);
const seg = (t, a, b) => clamp((t - a) / (b - a));
// keyframes: kf(t, [[t0, v0], [t1, v1], ...], easeFn) — values may be numbers or arrays
function kf(t, keys, e = ease) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) {
    const [a, va] = keys[i - 1], [b, vb] = keys[i], k = e((t - a) / (b - a));
    return Array.isArray(va) ? va.map((v, j) => lerp(v, vb[j], k)) : lerp(va, vb, k);
  }
  return keys[keys.length - 1][1];
}
function mixCol(a, b, k) {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const c = s => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, clamp(k)));
  return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1);
}
const shakeXY = (t, amt) => { const f = Math.floor(t * 24); return [(hash(f * 1.7) - .5) * 2 * amt, (hash(f * 2.3 + 9) - .5) * 2 * amt]; };

// ---------- project, shots, plates ----------
const PROJ = { title: 'untitled', fps: 24, duration: 10, boil: 12, audio: null, palette: {}, pixel: {} };
const P = PROJ.palette;                       // shorthand for palette colours in scenes: P.ink, P.paper, ...
function project(o) { const pal = o.palette; Object.assign(PROJ, o); PROJ.palette = P; if (pal) Object.assign(P, pal); }
const SHOTS = [];
// shot(start, end, fn): fn(t, lt, dur) paints the whole frame. t = film time, lt = time since shot start.
function shot(start, end, fn) { SHOTS.push({ start, end, fn }); SHOTS.sort((a, b) => a.start - b.start); }
// plate(name, fn): an expensive, static layer (backgrounds). Painted once per page, then reused as an image.
// Draw it inside a shot with usePlate(name) — it follows the active camera. Plates are painted in world space
// covering 0..W × 0..H and drawn `over` times larger around the centre so camera moves never show an edge.
const PLATES = {};
function plate(name, fn, o = {}) { PLATES[name] = { name, fn, over: o.over ?? 1.12, img: null }; }
function usePlate(name) { const p = PLATES[name]; if (p && p.img) STYLE.drawPlate(p); else if (p) p.fn(); }
// include('file.js'): split a project into several files (call at the top level of scenes.js)
function include(f) { document.write(`<script src="${PROJECT_DIR}/${f}"><\/script>`); }

// ---------- geometry ----------
function rectPts(x, y, w, h, j = 0) {
  return [[x + jit(j), y + jit(j)], [x + w / 2, y + jit(j)], [x + w + jit(j), y + jit(j)], [x + w + jit(j), y + h / 2],
          [x + w + jit(j), y + h + jit(j)], [x + w / 2, y + h + jit(j)], [x + jit(j), y + h + jit(j)], [x + jit(j), y + h / 2]];
}
function ellPts(cx, cy, rx, ry, n = 28, j = 0, rot = 0) {
  const p = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; p.push([cx + Math.cos(a) * rx + jit(j), cy + Math.sin(a) * ry + jit(j)]); } return p;
}
function rrPts(x, y, w, h, r, j = 0) {
  const p = [], corner = (cx, cy, a0) => { for (let i = 0; i <= 5; i++) { const a = a0 + i / 5 * Math.PI / 2; p.push([cx + Math.cos(a) * r + jit(j), cy + Math.sin(a) * r + jit(j)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI); return p;
}
function starPts(cx, cy, r, inner = .4, n = 5, rot = -Math.PI / 2) {
  const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, q = i % 2 ? r * inner : r; p.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); } return p;
}
function closed(pts) { return pts.concat([pts[0]]); }
// polyline cut at fraction u of its length (for "drawing on" a line)
function partial(p, u) {
  const d = []; let L = 0;
  for (let i = 1; i < p.length; i++) { d.push(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); L += d[i - 1]; }
  let s = clamp(u) * L; const out = [p[0]];
  for (let i = 1; i < p.length; i++) {
    if (s >= d[i - 1]) { out.push(p[i]); s -= d[i - 1]; }
    else { const f = s / d[i - 1]; out.push([lerp(p[i - 1][0], p[i][0], f), lerp(p[i - 1][1], p[i][1], f)]); break; }
  }
  return out;
}
// ribbon polygon around a centre line (for tubes, glows, worms): widths may be a number or fn(u)
function ribbon(line, width) {
  const L = [], R = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const w = typeof width === 'function' ? width(i / (line.length - 1)) : width, nx = -dy / d * w, ny = dx / d * w;
    L.push([line[i][0] + nx, line[i][1] + ny]); R.push([line[i][0] - nx, line[i][1] - ny]);
  }
  return L.concat(R.reverse());
}

// ---------- camera (one level; world point (cx, cy) lands at screen centre) ----------
let CAM = null;
function cam(cx = W / 2, cy = H / 2, zoom = 1, rot = 0) { CAM = { cx, cy, zoom, rot }; STYLE.camBegin(CAM); }
function camEnd() { if (CAM) STYLE.camEnd(); CAM = null; }
function toScreen(x, y) {
  if (!CAM) return [x, y];
  const c = Math.cos(CAM.rot), s = Math.sin(CAM.rot), dx = (x - CAM.cx) * CAM.zoom, dy = (y - CAM.cy) * CAM.zoom;
  return [W / 2 + dx * c - dy * s, H / 2 + dx * s + dy * c];
}

// ---------- drawing API (delegates to the active style) ----------
// Colours are '#rrggbb'. Common options: alpha (0..1).
// bg(color)                     fill the whole frame (use inside or outside cam())
// shape(pts, o)                 o: color, alpha, soft (0 = solid body, >0 = soft bloom/glow; 0..1 = how soft),
//                               texture (0..1 pigment texture on solid bodies), outline (colour or null), weight, smooth (0..1)
// stroke(pts, o)                o: color, weight (≈1 = normal line), alpha, brush ('ink' | 'fine' | 'dry' | 'pencil' | 'marker'), smooth
// dot(x, y, r, o)               small solid disc
// outside(pts, color)           paint everything outside a star-shaped outline (irises, keyholes, portholes)
// flash(k, color)               full-frame wash at strength k (0..1), screen space
// text(str, x, y, o)            o: size, color, font (CSS family), weight, italic, align, alpha, rot, screen (ignore camera), shadow
const bg = (c) => STYLE.bg(c);
const shape = (pts, o = {}) => STYLE.shape(pts, o);
const stroke = (pts, o = {}) => STYLE.stroke(pts, o);
const dot = (x, y, r, o = {}) => STYLE.shape(ellPts(x, y, r, r, Math.max(8, Math.min(24, Math.round(r))), 0), { outline: null, ...o });
const outside = (pts, c) => STYLE.outside(pts, c);
const flash = (k, c = '#ffffff') => { if (k > .005) STYLE.flash(clamp(k), c); };
let TEXTS = [];
function text(str, x, y, o = {}) {
  let size = o.size || 60, rot = o.rot || 0;
  if (CAM && !o.screen) { [x, y] = toScreen(x, y); size *= CAM.zoom; rot += CAM.rot; }
  TEXTS.push({ str, x, y, size, rot, color: o.color || P.ink || '#222', font: o.font || 'serif', weight: o.weight || 600,
               italic: !!o.italic, align: o.align || 'center', alpha: o.alpha ?? 1, shadow: o.shadow, spacing: o.spacing || 0 });
}
// jit(a): hand-drawn jitter, reseeded PROJ.boil times per second so lines "boil" like drawn animation.
// Styles scale it (pixel art uses none).
const jit = a => (STYLE.rand() * 2 - 1) * a * STYLE.jitter;

// ---------- frame ----------
let T = 0;
function paintFrame(t) {
  TEXTS = []; CAM = null;
  const s = SHOTS.find(s => t >= s.start && t < s.end) || SHOTS[SHOTS.length - 1];
  if (s) s.fn(t, t - s.start, s.end - s.start);
  if (CAM) camEnd();
}
const boilSeed = t => 1000 + Math.floor(t * PROJ.boil + 1e-6);

// render hooks used by tools/render.mjs
window.renderAt = async (t, type = 'image/png', q = .92) => { T = t; await STYLE.render(t); return STYLE.out.toDataURL(type, q); };
window.renderSheet = async (times, cols = 3, w = 640) => {
  const h = Math.round(w * 9 / 16), rows = Math.ceil(times.length / cols), sc = document.createElement('canvas');
  sc.width = cols * w; sc.height = rows * h; const c = sc.getContext('2d'), ms = [];
  for (let i = 0; i < times.length; i++) {
    const t0 = performance.now(); T = times[i]; await STYLE.render(times[i]); ms.push(Math.round(performance.now() - t0));
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    c.drawImage(STYLE.out, x, y, w, h); c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x, y, 90, 24); c.fillStyle = '#fff'; c.font = '15px sans-serif'; c.fillText(times[i].toFixed(2) + 's', x + 6, y + 17);
  }
  return { url: sc.toDataURL('image/jpeg', .88), ms };
};
window.projectInfo = () => ({ title: PROJ.title, fps: PROJ.fps, duration: PROJ.duration, audio: PROJ.audio, style: STYLE.name });
window.gpuInfo = () => STYLE.gpuInfo ? STYLE.gpuInfo() : 'n/a';
// Composite queued text onto a 2D context (screen space). Styles call this at the end of a frame.
function drawTexts(c, scale = 1) {
  for (const L of TEXTS) {
    if (L.alpha <= .01) continue;
    c.save(); c.translate(L.x * scale, L.y * scale); c.rotate(L.rot); c.globalAlpha = L.alpha;
    c.font = `${L.italic ? 'italic ' : ''}${L.weight} ${L.size * scale}px ${L.font}`;
    c.textAlign = L.align; c.textBaseline = 'middle';
    if ('letterSpacing' in c) c.letterSpacing = (L.spacing * scale) + 'px';
    if (L.shadow) { c.fillStyle = L.shadow; c.fillText(L.str, L.size * .04 * scale, L.size * .05 * scale); }
    c.fillStyle = STYLE.textColor ? STYLE.textColor(L.color) : L.color; c.fillText(L.str, 0, 0);
    c.restore();
  }
}
