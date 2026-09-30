# Engine reference

A **project** is a folder with a `scenes.js` (plus optional `cues.json`, `sound.wav`, extra `.js` files). It is
written once against the style-agnostic API below and can be rendered in any style.

```
my-shot/
  scenes.js      project({...}), plate(...), shot(...)
  cues.json      sound design cue sheet → tools/sfx.py → sound.wav
  sound.wav      soundtrack muxed into the MP4 (project({ audio: 'sound.wav' }))
  out/           renders, sheets, logs (created by tools/render.mjs)
```

## Rules that keep renders correct

- **Every shot paints the whole frame** and is a **pure function of `t`**. Frames render in parallel and out of
  order: no state between frames, no `Math.random()`. Use `hash(i)` for stable per-object randomness and
  `jit(a)` for hand-drawn jitter (reseeded `boil` times per second so lines "boil"; pixel style ignores it).
- World space is **1920×1080**, origin top-left, y down. Keep faces/key action away from where subtitles go
  (bottom ~120 px) when the film will carry subtitles.
- **Expensive, static backgrounds go in a `plate()`** — painted once per render page, reused every frame.
  In watercolor, a full-frame textured fill costs seconds on a CPU; a plate costs it once.
- Colours are `'#rrggbb'`; put them in `project({ palette })` and use `P.name`. The pixel style builds its
  palette from these, so a disciplined palette (10–18 colours) looks better in every style.
- Keep text light. Use `text()` for titles, labels and captions, not for narration (that goes in subtitles).

## Project

```js
project({
  title: 'ch01_lab',          // used in output file names
  style: 'watercolor',        // default style for this project (render --style=... overrides)
  fps: 24, duration: 12, boil: 12,
  audio: 'sound.wav',         // optional, relative to the project folder
  palette: { paper: '#F3EBDC', ink: '#2B2233', ... },
  pixel: { scale: 4, dither: .35, scanlines: .07, outline: 1, palette: null },
});
include('more_shots.js');     // split big projects into several files
```

## Timeline

```js
shot(start, end, (t, lt, dur) => { ... });   // t = film time, lt = time since this shot started
plate('name', () => { ... }, { over: 1.12 }); // static layer; draw with usePlate('name') inside a shot (follows cam)
```

## Drawing

| call | what it does |
|---|---|
| `bg(color)` | fill the frame |
| `shape(pts, o)` | filled polygon. `o.color, o.alpha, o.soft` (0 = solid body; 0.1–1 = soft bloom/glow), `o.texture` (pigment texture on solid bodies, `o.textureColor`), `o.outline` (colour), `o.weight`, `o.smooth` (0–1 curve through points) |
| `stroke(pts, o)` | line along points. `o.color, o.weight` (≈1 normal), `o.alpha, o.brush` (`ink`, `fine`, `dry`, `pencil`, `marker`, `pen`), `o.smooth` |
| `dot(x, y, r, o)` | small disc |
| `outside(pts, color)` | paint everything outside a star-shaped outline (irises, portholes, keyholes, vignettes) |
| `flash(k, color)` | full-frame wash at strength k, screen space |
| `text(str, x, y, o)` | `o.size, color, font` (CSS family list), `weight, italic, align, alpha, rot, spacing, shadow, screen` (ignore camera) |
| `cam(cx, cy, zoom, rot)` / `camEnd()` | world point (cx, cy) at screen centre; one level; pair them |

Geometry helpers: `rectPts, ellPts, rrPts, starPts, closed(pts), partial(line, u)` (draw-on), `ribbon(line, width | fn(u))`
(tube/worm/glow polygon around a centre line).

Timing & maths: `seg(t, a, b)`, `kf(t, [[t0, v0], ...], easeFn)`, `ease, easeIn, easeOut, easeInOut, backOut, elasticOut`,
`lerp, clamp, frac, wob(t, freq, phase), hash(i), mixCol(a, b, k), shakeXY(t, amount), TAU`.

## How each style interprets the calls

| call | watercolor | ink | pixel |
|---|---|---|---|
| solid `shape` | flat wash (+ pigment texture if `texture`) | pale tint + hatching by darkness (sparse on big areas, cross-hatch on small dark bodies) | flat fill snapped to palette |
| soft `shape` | watercolor bloom with bleeding edges | faint tint | 3 stepped bands |
| `stroke` | brush line (boils) | pen nib; light colours become ink | 1–3 art-pixel line |
| `text` | on the paint, under paper grain | light colours become ink | drawn at art resolution, snapped |
| cost | fills are expensive → plates | hatching moderate | cheap, no GPU needed |

## Rendering (tools/render.mjs)

```bash
node tools/render.mjs --project=shots/ch01 --sheet=0.5,2,4,6          # contact sheet (check a shot)
node tools/render.mjs --project=shots/ch01 --board=2,5 --styles=watercolor,ink,pixel   # style board
node tools/render.mjs --project=shots/ch01 --all                       # frames + MP4 with sound
node tools/render.mjs --batch=shots --all                              # every shot folder
node tools/render.mjs --project=... --bench                            # speed test
```
Options: `--style=`, `--workers=3`, `--soft` (no GPU: software WebGL), `--chrome=<path>`, `--frames=a:b`, `--encode`.
Frames are resumable (existing JPEGs are skipped). Measured: RTX 3060 Ti ≈ 0.1 s/frame (watercolor);
cloud container without GPU ≈ 10 s/frame watercolor, ≈ 0.3 s/frame pixel.

## Sound (tools/sfx.py) and edit (tools/assemble.py)

See the docstrings at the top of each file: `cues.json` → `sound.wav`; `edit.json` → final film with crossfades,
narration, ducked music and burned-in subtitles.
