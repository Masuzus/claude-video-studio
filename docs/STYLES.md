# Styles

Every style is one file in `engine/styles/` that implements the same small interface, so any project renders in
any style. Pick by showing the user a **style board** of *their* subject:

```bash
node tools/render.mjs --project=<shot> --board=<2–4 key times> --styles=watercolor,ink,pixel
```

| style | look | good for | watch out for |
|---|---|---|---|
| `watercolor` | watercolor washes and blooms, boiling ink line, paper grain and vignette | warm, poetic, storybook, medical/historical illustration, music videos | fills are expensive → use plates; slow without a GPU |
| `ink` | pen & ink sketch: pale tints, hatching by darkness, pen-nib lines on warm paper | notebooks, science sketches, documentary diagrams, "the scientist's notebook" | designed on light paper — dark scenes turn into light tinted drawings; light line colours become ink |
| `pixel` | low-res art pixels (default 480×270), palette-snapped colour bands, optional Bayer dithering and scanlines | retro/game feel, playful explainers, microscopic "sprite" worlds | thin details under ~2 art px disappear; keep the palette tight |

## Palette tips per style

- **watercolor**: 1 dark ground, 1 paper tone, 2–3 accent pigments, a pale highlight. Mix with `mixCol` rather than inventing new hues.
- **ink**: the palette's darkest colour (`P.ink`) is the pen. Colours with luminance > 0.78 are treated as "white" and drawn in ink.
- **pixel**: palette colours + a darker and a lighter shade of each are the only colours allowed.
  Set `pixel.palette` to an explicit list (e.g. a known 16-colour palette) for a stricter retro look;
  `pixel.scale` 3 → finer, 6 → chunkier; `dither` 0 = clean bands, .3–.6 = classic dither.

## Adding a style

Create `engine/styles/<name>.js` defining a global `STYLE` object:

```js
const STYLE = {
  name, jitter,            // jitter scale for jit() (0 = none)
  out, ctx,                // the #out canvas (1920×1080) and its 2D context
  rand(),                  // deterministic RNG, reseeded each frame from boilSeed(t)
  bg(col), shape(pts, o), stroke(pts, o), outside(pts, col), flash(k, col),
  camBegin(C), camEnd(), drawPlate(plate),
  render: async t => {},   // paint frame t (call paintFrame(t)), composite into out, drawTexts(ctx)
  textColor(col),          // optional: remap text colours
  gpuInfo(),               // optional
};
// on load: create canvases, bake PLATES (p.img = ...), then set window.ready = true
```

If the style needs p5 (`p5.brush`), add its name to `NEEDS_P5` in `engine/studio.html` and run p5 in **instance
mode** (see `watercolor.js`) — global mode collides with the engine's `text`, `stroke`, `lerp`.
Validate a new style with a style board of `examples/spirochete` before using it in a film.

Candidate styles for later: ink-wash (水墨), woodcut / engraving, paper cut-out with drop shadows,
risograph (two spot colours, halftone, misregistration), chalkboard, vintage film (grain, gate weave, flicker).
