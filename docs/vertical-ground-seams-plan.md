# Fix the vertical ground transitions

## Status of the diagnosis — read this first

**I did not reproduce the exact artifact in your screenshot.** I ran the real app in Chromium
against a generated test MIDI, at your viewport (824×444) and at 1280×720, sampled ~20 gameplay
frames, and scanned the ground band for hard vertical edges. Every frame I captured showed a
smooth ground. Your frame is a *green* biome; every state I hit was the purple/magenta palette,
so I never landed in the biome where you saw it.

Two attribution attempts that came back **negative**, recorded so nobody repeats them:

- **A/B with the light nulled** (forcing `terrainFacing()` to be skipped and the legacy uniform
  crest stroke to run): max luminance jump 159 with relief on, 185 with it off. No improvement —
  so on the frames I sampled, the new relief is *not* what produces the largest edges.
- **Mid-play viewport resize**, on the theory that the split was a torn backbuffer: the canvas
  backing store is a fixed 2560×1440 regardless of CSS size (`attrW/attrH` never change across
  824×444 → 1100×600 → 700×400). Resize does not tear it. That hypothesis is dead.

My first scanner was also unreliable: it flagged Midio's bright wireframe and the results-screen
panel edge as "seams." The corrected detector — count how many ground rows share a jump at the
same x, since a real seam spans the full ground depth and a character edge does not — is the one
worth keeping and is written up under Verification.

So: **step 0 is reproducing your frame**, and that needs input only you have (below).

## The one defect I did confirm, by reading and by measurement

Independent of whether it is *the* artifact, the terrain relief added in PR #60 is structurally
guaranteed to produce vertical banding:

`src/world/BiomeManager.js:3805-3813`

```js
for (let i = 0; i < bars.length; i++) {
  const f = facing[i];
  if (!(Math.abs(f) > 0.01)) continue;
  const bar = bars[i];
  ctx.fillStyle = f > 0
    ? `rgba(255,248,230,${(RELIEF_LIT_ALPHA * f).toFixed(3)})`
    : `rgba(0,0,0,${(RELIEF_SHADE_ALPHA * -f).toFixed(3)})`;
  ctx.fillRect(bar.x, bar.y, bar.width, canvas.height - bar.y);
}
```

Three problems, in order of severity:

1. **Piecewise-constant fill.** Each bar gets one uniform alpha across its whole width, with no
   interpolation to its neighbour. A hard vertical edge at every slice boundary is not a bug in
   the tuning — it is what this loop *is*. And the slices are wide: `SLICE_WIDTH_PX = 90`
   (`GroundField.js:13`), about 9–10 columns across an 824px frame. This is coarse quantization,
   not fine dithering.
2. **Full-depth columns.** `canvas.height - bar.y` repaints the entire ground body to the bottom
   of the frame, so every step is a full-height edge rather than a surface-shading nuance. This
   is what turns a subtle facing difference into a visible wall.
3. **Alphas calibrated against the wrong reference.** `RELIEF_LIT_ALPHA = 0.17` /
   `RELIEF_SHADE_ALPHA = 0.32` were chosen as "at or below the mountains' crest-catch / foot-sink"
   — but the mountain strips are fine-grained, while the ground is ~10 slices wide. Same alpha,
   vastly coarser geometry.

Measured on representative EQ terrain (offsets within `RISE_AMPLITUDE_PX = 30`), worst adjacent
step is **0.086 alpha across a zero-width boundary**. Visible banding; not on its own enough to
explain a near-black/green split, which is why step 0 still matters.

The crest stroke (`:3918-3934`) has the same quantization *plus* a geometry mismatch: it strokes
straight segments between bar centres, while the fill uses the quadratic-smoothed
`_terrainTopPath()`. The lit rim and the surface it belongs to are different curves.

## The fixes

**1. Replace the per-bar rects with two horizontal gradients.**
Build `createLinearGradient(0, bar.y, canvas.width, ...)` across the visible span with a colour
stop at each bar centre, and fill once. Two passes, not one: a **lit** pass
(`rgba(255,248,230, max(0,f)·LIT)`) and a **shade** pass (`rgba(0,0,0, max(0,-f)·SHADE)`), each
clamping the opposite sign to zero alpha. Two passes rather than one gradient because a single
gradient interpolating a white stop to a black stop passes through muddy mid-grey at the zero
crossing, where the correct value is fully transparent. Canvas interpolates between stops, so the
hard edges disappear by construction, and it is *cheaper* than today — 2 fills instead of N.

**2. Derive facing from the smoothed curve, not raw bar centres.**
`terrainFacing()` currently takes the tangent between bar *centres* 180px apart, which is a coarse
approximation of a surface the fill draws as a smooth quadratic. Sample the same curve
`_terrainTopPath()` uses, at sub-slice resolution (every ~10px), so the normal varies continuously
within a slice instead of stepping once per 90px. This also damps the frame-to-frame flicker that
comes from a live EQ terrain jittering the tangent.

**3. Fade the relief with depth.**
Add a vertical falloff so the relief concentrates near the ridge and dies within ~60–80px, rather
than tinting the ground to the bottom of the frame. This is what makes it read as *surface*
shading, and it also means any residual discontinuity is confined to a thin band instead of
running the full height.

**4. Stroke the crest as one smoothed path with a gradient.**
Set `strokeStyle` to a horizontal gradient built the same way as (1) and stroke `strokePath` once,
instead of N straight per-segment strokes at N alphas. Fixes the alpha stepping and the
fill/stroke geometry mismatch together.

Keep the existing discipline that made #57/#58/#60 safe: **omit the light and the output must be
byte-identical to today**, so the existing tests stay green untouched.

## Files

- `src/world/TerrainRelief.js` — sub-slice sampling; re-tune the two alpha constants; add the
  depth-falloff constant
- `src/world/BiomeManager.js` — `_drawGround` relief block (`:3794-3815`) and crest stroke
  (`:3915-3940`)
- `test/terrainRelief.test.js` — extend

## Verification

**Unit:** no-light output byte-identical to today (regression guard, write first); facing is
continuous — assert that sampling across a slice boundary produces no jump above a small epsilon,
which is the property the current code violates; relief alpha reaches zero by the falloff depth.

**Pixel, in Chromium** (dev server `node tools/serve.js 8080`, launch with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`; the app exposes
`window.__SMW.sim`):

Use the corrected seam detector, not a naive max-jump scan:

```js
// A real vertical seam shows a jump at the SAME x across many ground rows.
// A character edge or UI panel spans only its own height.
for (let dy = 15; dy <= 200; dy += 12) { /* count jumps > 12 per x */ }
// flag when one x accounts for >= 60% of sampled rows
```

Acceptance: no x accounts for a jump across more than ~30% of ground rows, sustained over 20+
gameplay frames, **in the biome where the artifact reproduces**. Exclude the character bounding
boxes and the results overlay — both produced false positives for me.

House convention: scratch scripts as `scratch_*.mjs` at repo root, `rm -f`'d before committing;
`pkill -f "tools/serve.js"` when done.

## What I need from you for step 0

The artifact is state-dependent and I could not hit it. Any of these would let me reproduce it
directly rather than fixing it blind:

- the **song** (or the seed — the results screen prints one, e.g. `EE043F02`)
- roughly **when** in the track it happened, or which section
- whether it **persists** for seconds or flickers for a frame — persistent points at the relief
  banding, a single-frame flash points at a compositing/clear bug instead

Without that, fixes 1–4 are still worth doing — they remove a defect that is provably there — but
I can't promise they are the thing in your screenshot.
