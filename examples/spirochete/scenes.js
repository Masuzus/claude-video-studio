// examples/spirochete — 8 s test shot "into the dark field" (from the syphilis short 《苍白编年史》).
// 0.0–1.2  a microscope eyepiece opens on the paper, revealing a dark field
// 1.2–4.6  pale spirochetes corkscrew through the field, red cells drift, the field breathes with a heartbeat
// 4.6–6.2  the eyepiece dissolves outward and the camera dives toward the lead spirochete
// 6.2–8.0  title card
// Written once against the style-agnostic API; render with style=watercolor | ink | pixel.

project({
  title: 'spirochete', style: 'watercolor', fps: 24, duration: 8, boil: 12, audio: 'sound.wav',
  palette: {
    paper: '#EDE2CC', ink: '#2B2233', field: '#15172F', field2: '#262B57', pale: '#F4EEDC', glow: '#BFE3DA', glow2: '#9FC7E8',
    rbc: '#8E3B52', rbcLt: '#D0788A', rbcEdge: '#F2BDC6', brass: '#E8AA38', clay: '#A84D33',
    bloomA: '#3B3F7E', bloomB: '#2E4D6B', bloomC: '#4A3A6E', deepRed: '#5E2A45',
  },
  pixel: { scale: 4, scanlines: .07, dither: .35 },
});
const SERIF = '"Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif';

// heartbeat: 1 on each beat (every .9 s from 1.2 s), decaying — the soundtrack uses the same times
const hb = t => t < 1.2 ? 0 : Math.exp(-frac((t - 1.2) / .9) * 5);

// ---------- background plate (painted once) ----------
const BLOOMS = [[520, 360, 420, 'bloomA'], [1450, 700, 480, 'bloomB'], [1100, 250, 300, 'bloomC'], [300, 880, 360, 'deepRed'], [980, 620, 260, 'bloomB']];
plate('field', () => {
  shape(rectPts(-200, -200, W + 400, H + 400), { color: P.field, texture: .7, textureColor: P.field2 });
  BLOOMS.forEach(([x, y, r, c]) => shape(ellPts(x, y, r, r * .75, 22, 12), { color: P[c], alpha: .38, soft: .85 }));
  for (let i = 0; i < 6; i++) {
    const x = 150 + hash(i + 50) * 1620, y = 100 + hash(i + 60) * 880, r = 60 + hash(i + 70) * 40;
    shape(ellPts(x, y, r, r * (.5 + hash(i + 80) * .5), 26, 3, hash(i + 90) * TAU), { color: P.deepRed, alpha: .3, soft: .6 });
  }
});
function field(t) {
  usePlate('field');
  const k = hb(t);
  BLOOMS.forEach(([x, y, r, c], i) => {
    const rr = r * (.8 + .06 * k) + 15 * wob(t, .1, i * .3);
    shape(ellPts(x + 30 * wob(t, .07, i), y + 20 * wob(t, .09, i + .5), rr, rr * .72, 24, 6), { color: mixCol(P[c], P.glow2, .25), alpha: .04 + .09 * k });
  });
  for (let i = 0; i < 40; i++) {
    const x = frac(hash(i + 300) + t * (.004 + hash(i + 301) * .01)) * (W + 400) - 200, y = hash(i + 302) * H + 25 * wob(t, .12, hash(i + 303));
    dot(x, y, 1.5 + hash(i + 304) * 4, { color: P.pale, alpha: .25 + .35 * hash(i + 305) });
  }
}

// ---------- spirochetes: a regular helix around a gently bending axis ----------
function axisAt(sp, s, t) {
  const [hx, hy] = sp.head(t), a = sp.ang(t), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const bend = sp.bend * Math.sin(s / sp.L * Math.PI * 1.3 + t * sp.bendW + sp.seed) * (s / sp.L);
  return [hx - dx * s + nx * bend, hy - dy * s + ny * bend, nx, ny];
}
function spirochete(sp, t, dim = 1) {
  const n = Math.ceil(sp.L / sp.lam * 14), pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n * sp.L, env = Math.pow(Math.sin(Math.PI * clamp(s / sp.L * .96 + .02)), .35);
    const [x, y, nx, ny] = axisAt(sp, s, t), ph = s / sp.lam * TAU + t * sp.w + sp.seed * 7, off = sp.A * env * Math.sin(ph);
    pts.push({ x: x + nx * off, y: y + ny * off, z: Math.cos(ph), ax: x, ay: y, nx, ny, env });
  }
  // glow around the body
  const hull = f => ribbon(pts.filter((_, i) => i % 3 === 0).map(p => [p.ax, p.ay]), u => f * (sp.A + sp.glow) * (.35 + .65 * Math.pow(Math.sin(Math.PI * clamp(u * .96 + .02)), .35)));
  if (sp.hero) shape(hull(1.6), { color: P.glow, alpha: .17 * dim, soft: .9 });
  else for (const f of [1.5, 1.0, .6]) shape(hull(f), { color: sp.glowCol, alpha: sp.glowA * dim * .16 });
  // back of the coil: one continuous thin line; front half-turns: thicker and brighter
  stroke(pts.map(p => [p.x, p.y]), { color: mixCol(P.pale, P.field, .35 + .35 * (1 - dim)), weight: sp.sw * .55, brush: 'fine' });
  const fr = mixCol(P.pale, P.field, .45 * (1 - dim)), runs = []; let cur = [];
  for (const p of pts) { if (p.z > -.15) cur.push([p.x, p.y]); else if (cur.length) { runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  for (const r of runs) if (r.length > 1) stroke(r, { color: fr, weight: sp.sw });
}
const HERO = {
  hero: true, L: 760, lam: 58, A: 20, sw: 1.5, w: -7.5, bendW: 1.1, bend: 70, seed: .7, glow: 22,
  head: t => [lerp(360, 1130, t / 8), lerp(840, 470, t / 8) + 18 * wob(t, .23)],
  ang: t => -0.47 + .12 * wob(t, .17, .2),
};
const FLOCK = Array.from({ length: 7 }, (_, i) => {
  const h = k => hash(i * 13.7 + k);
  const L = 300 + h(1) * 320, a0 = h(2) * TAU, v = 45 + h(3) * 55, x0 = 180 + h(4) * 1560, y0 = 120 + h(5) * 840;
  return {
    L, lam: 34 + h(6) * 18, A: 9 + h(7) * 6, sw: .75 + h(8) * .45, w: -(5 + h(9) * 5), bendW: .6 + h(10), bend: 30 + h(11) * 60, seed: i * 1.9,
    glow: 14, glowA: (22 + h(12) * 18) / 255, glowCol: i % 2 ? '#BFE3DA' : '#9FC7E8', depth: .45 + h(13) * .55,
    head: t => [x0 + Math.cos(a0) * v * (t - 4), y0 + Math.sin(a0) * v * (t - 4) + 20 * wob(t, .2, h(14))],
    ang: t => a0 + .15 * wob(t, .15, h(15)),
  };
});

// ---------- red cells ----------
function redCell(x, y, r, tilt, rot, dim) {
  const ry = r * (.35 + .65 * Math.abs(Math.cos(tilt)));
  shape(ellPts(x, y, r, ry, 30, 1.5, rot), { color: P.rbc, alpha: .67 * dim, outline: mixCol(P.rbcEdge, P.field, 1 - dim), weight: .7 });
  shape(ellPts(x + r * .06, y - ry * .05, r * .48, ry * .42, 20, 1, rot), { color: P.rbcLt, alpha: .27 * dim });
}
const CELLS = Array.from({ length: 9 }, (_, i) => {
  const h = k => hash(i * 7.3 + 100 + k);
  return { x0: -100 + h(1) * 2100, y0: 60 + h(2) * 960, r: 46 + h(3) * 34, vx: 22 + h(4) * 26, vy: (h(5) - .5) * 14, tilt: h(6) * TAU, tw: .15 + h(7) * .3, rot: h(8) * TAU, front: h(9) > .62, dim: .55 + h(10) * .45 };
});

// ---------- eyepiece ----------
function eyepiece(R) {
  if (R > 1200) return;
  if (R < 6) { bg(P.paper); return; }
  outside(ellPts(960, 540, R, R, 72), P.paper);
  const ring = r => closed(ellPts(960, 540, r, r, 72, 1.5));
  stroke(ring(R + 16), { color: P.brass, weight: 2.4, brush: 'dry' });
  stroke(ring(R + 3), { color: P.ink, weight: 1.9 });
  stroke(ring(R + 30), { color: P.ink, weight: .8, brush: 'fine' });
}

// ---------- the shot ----------
shot(0, 8, t => {
  const R = t < 1.25 ? kf(t, [[.05, 0], [1.25, 470]], backOut) : kf(t, [[1.25, 470], [4.6, 505], [6.1, 1300]], easeIn);
  const [hx, hy] = axisAt(HERO, HERO.L * .35, t), dive = ease(seg(t, 4.4, 6.6));
  const zoom = kf(t, [[0, 1], [4.4, 1.12], [6.6, 2.1], [8, 2.25]]);
  if (R > 5) {
    const [sx, sy] = shakeXY(t, 1.2 * hb(t));
    cam(lerp(960 + 30 * wob(t, .08), hx, dive) + sx, lerp(540 + 20 * wob(t, .06), hy, dive) + sy, zoom, .03 * wob(t, .05));
    field(t);
    for (const c of CELLS) if (!c.front) redCell(c.x0 + c.vx * t, c.y0 + c.vy * t, c.r, c.tilt + t * c.tw, c.rot, c.dim * .7);
    for (const sp of FLOCK) spirochete(sp, t, sp.depth);
    spirochete(HERO, t, 1);
    for (const c of CELLS) if (c.front) redCell(c.x0 + c.vx * t, c.y0 + c.vy * t, c.r * 1.25, c.tilt + t * c.tw, c.rot, c.dim);
    camEnd();
  }
  eyepiece(R);

  const noteA = seg(t, .7, 1.3) * (1 - seg(t, 4.5, 5.1));
  if (noteA > .01) {
    text('Treponema pallidum', 1500, 905, { size: 34, italic: true, font: SERIF, color: P.ink, alpha: noteA, rot: -.04 });
    text('暗视野  ×1000', 1500, 950, { size: 28, font: SERIF, color: P.clay, alpha: noteA, rot: -.04 });
    stroke([[1350, 978], [1650, 972]], { color: P.ink, weight: .8, brush: 'fine', alpha: noteA });
  }
  const ta = seg(t, 6.15, 7.0);
  if (ta > 0) {
    flash(.5 * ease(ta), P.field);
    const k = easeOut(ta);
    text('苍白编年史', 960, 470 - 14 * (1 - k), { size: 150, weight: 900, font: SERIF, color: P.pale, alpha: k, screen: true });
    const u = easeOut(seg(t, 6.5, 7.4));
    if (u > .02) stroke([[960 - 330 * u, 575], [960 + 330 * u, 571]], { color: P.brass, weight: 1.6, brush: 'dry' });
    text('THE PALE CHRONICLE', 960, 632, { size: 38, font: SERIF, color: P.glow, alpha: ease(seg(t, 6.8, 7.5)), screen: true, spacing: 14 });
  }
});
