// styles/watercolor.js — painted watercolor + ink line on textured paper (p5.js 2.x + p5.brush, WEBGL).
// Also serves the 'ink' variant (styles/ink.js): pen hatching + pale ink washes, like a drawn illustration.
//
// Cost model (important for render time): watercolor fills (shape with soft > 0 or texture > 0) are by far the
// most expensive call, roughly proportional to their area. Flat bodies (washes) and strokes are cheap.
// Put large textured backgrounds in a plate() so they are painted once, not every frame.

const BRUSH_VARIANT = window.BRUSH_VARIANT || 'watercolor';
const INK = BRUSH_VARIANT === 'ink';

// p5 runs in instance mode (Q5) so its functions don't collide with the engine's global API (text, stroke, lerp...)
let Q5 = null, PAPER = null, GRAIN = null, BAKING = null;
const STYLE = {
  name: BRUSH_VARIANT, jitter: 1, out: null, ctx: null,
  rand: () => Q5.random(),
};

// ---------- paper & grain ----------
function lcg(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function makePaper(base) {
  const g = Q5.createGraphics(W, H); g.pixelDensity(1); const c = g.drawingContext, rnd = lcg(11);
  c.fillStyle = base; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, r = 120 + rnd() * 380, gr = c.createRadialGradient(x, y, 0, x, y, r), a = .04 * rnd();
    gr.addColorStop(0, `rgba(150,120,80,${a})`); gr.addColorStop(1, 'rgba(150,120,80,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * W, y = rnd() * H, l = 6 + rnd() * 26, a = rnd() * TAU;
    c.strokeStyle = `rgba(110,88,60,${.03 + rnd() * .05})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + .6) * l * .5, y + Math.sin(a + .6) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  return g;
}
function makeGrain() {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), rnd = lcg(5);
  const id = c.createImageData(W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const v = 255 - (rnd() < .55 ? rnd() * rnd() * 30 : 0); d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 3; d[i + 3] = 255; }
  c.putImageData(id, 0, 0);
  const g = c.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(120,95,70,.32)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  return cv;
}

// ---------- helpers ----------
const lum = c => { const n = parseInt(c.slice(1, 7), 16); return (.299 * (n >> 16 & 255) + .587 * (n >> 8 & 255) + .114 * (n & 255)) / 255; };
const areaOf = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// ink style: every line is ink — light line/text colours turn into dark ink (keeping a hint of their hue)
const inkify = c => INK && lum(c) > .78 ? mixCol(P.ink || '#2B2233', c, .12) : c;
const withAlpha = (c, a) => a >= 1 ? c : c.slice(0, 7) + Math.round(clamp(a) * 255).toString(16).padStart(2, '0');
function poly(pts, curv) {
  if (curv) { brush.beginShape(curv); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true); }
  else brush.polygon(pts);
}
function outline(pts, col, w, curv, br = 'cvs_ink') {
  brush.noWash(); brush.noFill(); brush.noHatch(); brush.set(br, col, w);
  brush.beginShape(curv || 0); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
}
const BRUSHES = { ink: 'cvs_ink', fine: 'cvs_fine', dry: 'cvs_dry', pencil: '2B', marker: 'marker', pen: 'cvs_pen' };

// ---------- drawing API ----------
STYLE.bg = col => {
  brush.noStroke(); brush.noFill(); brush.noHatch(); brush.wash(INK ? mixCol(PROJ.palette.paper || '#F3EBDC', col, .22) : col, 255);
  brush.polygon([[-3000, -3000], [W + 3000, -3000], [W + 3000, H + 3000], [-3000, H + 3000]]);
};
STYLE.shape = (pts, o) => {
  const col = o.color || P.ink || '#222', a = o.alpha ?? 1, curv = o.smooth || 0;
  brush.noStroke(); brush.noHatch();
  if (INK) {
    // pen & ink: pale tint of the colour; hatching only where it reads — big areas get sparse single hatching,
    // small dark bodies get cross-hatching. Light colours stay as paper (their outline carries them).
    const paper = PROJ.palette.paper || '#F6F1E6', L = lum(col), big = Math.abs(areaOf(pts)) > W * H * .15;
    brush.noFill(); brush.wash(mixCol(paper, col, o.soft ? .16 : big ? .3 : .34), 255 * a * (o.soft ? .8 : 1)); poly(pts, curv);
    if (!o.soft && L < .6 && a > .3) {
      const hc = mixCol(mixCol(col, P.ink || '#222', .4), paper, big ? .45 : 0);
      brush.noWash();
      if (big) { brush.hatch(30, .8, { rand: .25, continuous: false, gradient: .4 }); brush.hatchStyle('HB', hc, .8); poly(pts, curv); }
      else {
        const d = 7 + 16 * L; brush.hatch(d, .75, { rand: .12, continuous: false, gradient: .2 }); brush.hatchStyle('cvs_pen', hc, .8); poly(pts, curv);
        if (L < .3) { brush.hatch(d * 1.3, -.7, { rand: .12, continuous: false, gradient: .2 }); poly(pts, curv); }
      }
      brush.noHatch();
    }
  } else if (o.soft) {
    brush.noWash(); brush.fill(col, 255 * a); brush.fillBleed(.04 + .32 * o.soft); brush.fillTexture(o.texture ?? .3, .1 + .3 * (1 - o.soft));
    poly(pts, curv); brush.noFill();
  } else {
    brush.wash(col, 255 * a);
    if (o.texture) { brush.fill(o.textureColor || mixCol(col, P.ink || '#222', .3), 150 * o.texture); brush.fillBleed(.08); brush.fillTexture(.8, .35); } else brush.noFill();
    poly(pts, curv); brush.noFill(); brush.noWash();
  }
  if (o.outline) outline(pts, inkify(o.outline), o.weight ?? 1, curv, o.soft ? 'cvs_fine' : 'cvs_ink');
};
STYLE.stroke = (pts, o) => {
  if (pts.length < 2) return;
  brush.noFill(); brush.noWash(); brush.noHatch();
  const b = INK && (!o.brush || o.brush === 'ink') ? 'cvs_pen' : (BRUSHES[o.brush || 'ink'] || o.brush);
  brush.set(b, withAlpha(inkify(o.color || P.ink || '#222'), o.alpha ?? 1), o.weight ?? 1);
  if (pts.length === 2) brush.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1]); else brush.spline(pts, o.smooth ?? 0);
};
STYLE.outside = (pts, col, far = 5000) => {
  const n = pts.length; let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
  const out = p => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1; return [cx + dx / d * far, cy + dy / d * far]; };
  brush.noStroke(); brush.noFill(); brush.noHatch(); brush.wash(col, 255);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], ex = (b[0] - a[0]) * .06, ey = (b[1] - a[1]) * .06, a2 = [a[0] - ex, a[1] - ey], b2 = [b[0] + ex, b[1] + ey];
    brush.polygon([a2, b2, out(b2), out(a2)]);
  }
  brush.noWash();
};
STYLE.flash = (k, col) => {
  Q5.push(); Q5.resetMatrix(); Q5.translate(-W / 2, -H / 2);
  brush.noStroke(); brush.noFill(); brush.noHatch(); brush.wash(INK ? mixCol(PROJ.palette.paper || '#F6F1E6', col, .3) : col, 255 * k); brush.polygon([[-60, -60], [W + 60, -60], [W + 60, H + 60], [-60, H + 60]]); brush.noWash();
  Q5.pop();
};
STYLE.camBegin = C => { Q5.push(); Q5.translate(W / 2, H / 2); Q5.rotate(C.rot); Q5.scale(C.zoom); Q5.translate(-C.cx, -C.cy); };
STYLE.camEnd = () => Q5.pop();
STYLE.drawPlate = p => { const o = p.over; Q5.image(p.img, W / 2 - W * o / 2, H / 2 - H * o / 2, W * o, H * o); };
STYLE.textColor = c => inkify(c);
STYLE.gpuInfo = () => { const gl = Q5.drawingContext, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); };

// ---------- lifecycle ----------
new p5(p => {
  Q5 = p; brush.instance(p);
  p.setup = async () => {
    p.createCanvas(W, H, p.WEBGL); p.pixelDensity(+(Q.get('pd') || 1)); p.noLoop();
    brush.scaleBrushes(5);
    brush.add('cvs_ink', { type: 'default', weight: 5, scatter: .25, sharpness: .8, grain: 40, opacity: 235, spacing: .2, pressure: [1.15, .75], rotate: 'natural', noise: .15 });
    brush.add('cvs_fine', { type: 'default', weight: 2.6, scatter: .15, sharpness: .85, grain: 40, opacity: 230, spacing: .2, pressure: [1.1, .8], rotate: 'natural', noise: .1 });
    brush.add('cvs_dry', { type: 'default', weight: 14, scatter: 3, sharpness: .3, grain: 6, opacity: 90, spacing: .6, pressure: [1, .6], rotate: 'natural', noise: .4 });
    brush.add('cvs_pen', { type: 'default', weight: 1.8, scatter: .12, sharpness: .9, grain: 30, opacity: 240, spacing: .2, pressure: [1.2, .7], rotate: 'natural', noise: .12 });
    STYLE.out = document.getElementById('out'); STYLE.ctx = STYLE.out.getContext('2d');
    PAPER = makePaper(PROJ.palette.paper || (INK ? '#F6F1E6' : '#F3EBDC')); GRAIN = makeGrain();
    setTimeout(async () => {                                      // p5 ignores redraw() until setup() has returned
      await document.fonts.ready;
      for (const pl of Object.values(PLATES)) {                   // bake plates once per page
        BAKING = pl; await p.redraw(); pl.img = await p.loadImage(p.drawingContext.canvas.toDataURL('image/png'));
      }
      BAKING = null; window.ready = true;
    }, 0);
  };
  p.draw = () => {
    if (!STYLE.out) return;
    p.push(); p.translate(-W / 2, -H / 2);
    p.randomSeed(boilSeed(T)); p.noiseSeed(77);
    p.image(PAPER, 0, 0);
    if (BAKING) BAKING.fn(); else paintFrame(T);
    p.pop();
  };
});
STYLE.render = async t => {
  T = t; await Q5.redraw();
  const c = STYLE.ctx;
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.drawImage(Q5.drawingContext.canvas, 0, 0, W, H);
  drawTexts(c);
  c.globalCompositeOperation = 'multiply'; c.drawImage(GRAIN, 0, 0); c.globalCompositeOperation = 'source-over';
};
