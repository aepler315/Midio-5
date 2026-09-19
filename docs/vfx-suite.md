# Visual Effects Suite — implementation and verification

Checked against the implementation on September 18, 2026. This document
separates implemented behavior from tests and remaining acceptance work.
The main painterly path is `src/render/Renderer.js`; Cathode has its own
renderer and CRT pipeline. Directors consume timeline/simulation state;
the renderer consumes their output rather than analyzing audio itself.

## Impact and trail inventory

`ImpactFX` stores positions in world space and projects them with
`wx - worldX + originX`. `Simulation` seeds it with the song seed.

| Effect | Capacity | Lifetime / behavior |
| --- | --- | --- |
| Crater flash | 16 | 0.12 s; biome-tinted landing light |
| Landing dust ring | 16 | 0.42 s; 24 jittered segments |
| Judgment ring | 16, separate pool | Dedicated capacity keeps landing decoration from starving verdicts |
| Dust motes | 400 | 0.26–0.42 s for landings; also judgment/sputter particles |
| Star-polygon shockwave | 8 | 0.5 s; hard landings (`I > 0.5`) |
| Paint splat | 20 | 2.8 s; rhythm-clean landings and authored events |
| Gold ignition ring | 8 | 0.5 s; Apotheosis |
| Ground scar | 60, manual list | 4 s |

Landing intensity is `clamp(vLand / vRef, 0, 1)^0.7`; camera shake is
`5.5 * I`. Pool allocation returns `null` at capacity; ring initialization
is guarded. Pools recycle objects, while some effect payloads (for example
splat blob arrays) still allocate. This is not an allocation-free engine.

`RippleFX` adds expanding perspective rings, ground pulses and biome-tinted
landing puffs. Its radius, lifetime, opacity and puff trajectories have pure
helpers and tests. Ring count and puff count consume the particle multiplier,
with minimum feedback counts; zero multiplier does not disable every effect.

`ImpactFX` trigger, judgment, sputter and splat accept particle multipliers.
Some simulation events multiply the governor budget by fever headroom;
other authored events intentionally use the default. These are effect budgets,
not a promise that every draw count scales identically.

`RainbowBrush` deposits world-locked square dabs while airborne: at most 320,
3.2 s lifetime, 8 px nominal spacing, 16° hue steps. Spacing widens under
particle shedding. Draw skips expired, future-dated and off-screen dabs;
the entire brush is gated at governor level 5. Reduced flash uses normal
compositing instead of additive blending.

Murmuration and OrbitalDebris render a bounded subset of their fixed simulated
collections. The draw multiplier affects emitted wing segments/triangles,
not the size of the simulation arrays. Zero or negative multipliers emit no
geometry; values above one cannot read beyond the collection.

## Lighting and world boundaries

`LightField` resolves a shared celestial light and local ground/character
lights. Celestial intensity is
`budget * (1 - unravel) * (1 - 0.5 * dayArcAlpha)`; reduced flash compresses
it toward a steady 0.6 baseline rather than applying a flash cap.

Song adaptation preserves each stock palette's `edgeLight`, so Nave's
stained-glass spill, Foundry's furnace glow and Redline's neon band remain
available. Intentionally unlit stock palettes stay unlit. Seven specialized
worlds shade the exact fitted vertices and placement of their static strips;
Range retains its dancing terrain. Ceiling strips have their own geometry.

Fathom and Nave pass `{ astronomical: false }` to the shared sky renderer.
They retain the base gradient, atmospheric plate and local palette effects
such as light shafts, bioluminescence and motes. Stars, galactic layers,
space dust, aurora and nebula bloom are excluded. Their celestial objects
remain the underwater sun and rose window. The default open-sky behavior is
unchanged. The final film grade remains a separate, shared color treatment.

Redline and Cathode travel integrate smoothed song energy into cumulative
distance. They no longer multiply the current rate by elapsed song age.
Direct and backward seeks therefore agree with the integrated timeline.

Protected hues remain Midio (`178°`), hazard (`#ff4d4d`) and reward
(`#ffd75e`). `VisualStyle.styleDials()` is authoritative for shared style:
current bloom multiplier 0.9, film grade 1.45, vignette 1.08, glow halo 0.95
and rim amount 0.95. World identity still needs visual review across songs;
those numbers alone do not establish balanced compositions.

## Reduced flash

The persisted preference defaults to `prefers-reduced-motion` when no
explicit preference is stored. The per-effect flash helper caps alpha at
`FLASH_CAP = 0.4`.

- Impact flashes/rings, RippleFX and other flash-aware effects cap their
  transient opacity. Landing additive effects switch to `source-over`.
- The hype echo and drop motion blur are disabled. The hype border caps its
  final opacity (including focus weighting) and switches to `source-over`.
- Drop shockwave rings, shock blits and speed lines cap opacity and switch to `source-over`;
  the chromatic displacement is also halved.
- Cathode suppresses screen hits/tearing and reduces raster travel speed.
- Film grading is a slow color treatment, not a beat flash. Celestial light
  compression and bloom's steady base have separate rules.

A per-draw alpha limit is not a frame-wide luminance guarantee. Normal
compositing avoids additive summation, but overlapping layers and remaining
post-processing can still alter contrast. These implementation checks do
not constitute a photosensitivity certification or exhaustive flash audit.

## Performance governor

`PerfGovernor.sample()` receives the **rAF frame period**, including vsync
wait, not JavaScript draw cost. Its threshold is **18.5 ms**.

- Song/world construction starts **2,500 ms warmup grace**; those frames do
  not vote on shedding.
- Each period above budget adds `min(6, deltaMs / 18.5)` load units. At 60
  units it sheds one level and clears the accumulator.
- A clean period removes 0.5 load units, bounded at zero. Intermittent judder
  can accumulate evidence; one clean frame no longer erases it.
- Ten uninterrupted clean seconds recover one level. An over-budget period
  restarts that recovery window.
- `?perf=high` starts at 0; `?perf=lite` starts at 2. Coarse-pointer or small
  viewport otherwise starts at 1. These choose the initial level only.

| Level | Additional degradation |
| --- | --- |
| 1 | Disable vision self-tuning; widen dancing-strip columns 16→32 px |
| 2 | Particle multiplier 0.6; disable rim lighting |
| 3 | Disable contact shadows, crack-glow capability and bloom; columns 64 px |
| 4 | Disable L7 veil |
| 5 | Disable optional phenomena and RainbowBrush |
| 6 | Haze 3→1 layers; disable heavy finishing/echo/blur; reduce terrain shading to its retained catchlight |

Above 2560 backing-store pixels, column width doubles (maximum 128). Every
preset is capped to the pixels its contained 16:9 stage can actually present;
manual presets otherwise remain fixed. Auto alone reduces its fitted backing
store to 85%, 75% and 62.5% at levels 2, 3 and 4. Retro mode pins level 6,
particle multiplier 0.35 and 128 px columns; optional retro palette
quantization only runs with that mode.

Some capabilities are historical: the painterly renderer no longer draws
fracture cracks, although the timing engine and governor accessor remain.
Profile-crossfade memoization and per-pixel crack refraction are not
implemented features and are not claimed as savings.

## Painterly draw order

The important boundaries in `Renderer.draw()` are:

1. Sky/parallax/phenomena use the zoomed view. The world renderer then switches
   to the fixed ground view for ground, footing and flood.
2. Burrow/desaturation/telegraph, obstacles, ImpactFX and RippleFX precede
   battle enemies, brush and characters. Shadows precede their characters;
   Midio's afterimages precede his core.
3. Epicycles/drop shockwave, Midasus, character reflections, battle FX and
   gnat precede the foreground veil and transposition wave. Fracture drawing
   has been removed; its simulation timing still exists.
4. After restoring the camera transform, the opening assembly captures the
   clean world composite **before post-processing and HUD**.
5. Fever aura → hype frame → drop impact → drop motion blur → bloom → heat
   distortion → film finish. Pixel-sampling passes use the physical backing
   store at identity transform; logical overlays use the stage transform.
6. HUD/seek strip follows post-processing. Assembly shards follow the HUD.
   Optional retro palette quantization follows assembly. Freeze and highlight
   capture use the completed frame.

Ambient heat distortion grows toward the ground in backing-store coordinates;
it is no longer strongest at the top. Radial drop distortion remains a
separate contribution.

## Seeking and lifecycle

Seeking rebuilds playback simulation/renderer state at the destination,
clearing future transformations, cooldowns, disasters, trails and frame
history. Song, seed, world, presentation preferences, recording and paused
state are retained. Skipped events are advanced silently, destination scene
state and interpolation are initialized, and future anticipation is primed.
Score/holds and spatial origin restart as a new performance segment. This
is a fresh destination state, not replay of every earlier random particle.

## Verification and remaining acceptance work

| Area | Evidence in the repository |
| --- | --- |
| Impact saturation, separate feedback pool, flash handling, spawn scaling | `test/impactFX.test.js` |
| Ripple curves and scaled feedback | `test/rippleFX.test.js` |
| Brush lifetime, scaling, culling and future timestamps | `test/rainbowBrush.test.js` |
| Hype border, both shockwave rings, shock blits and speed-line opacity/compositing | `test/rendererFlash.test.js` |
| Backing-store sampling and blur | `test/rendererDrawables.test.js` |
| Governor shedding, grace and recovery | `test/perf-governor.test.js` |
| Observed particle draw counts | `test/perfGovernorConsumers.test.js` |
| Interior sky exclusions and retained shafts | `test/interiorSky.test.js` |
| Specialized-world blit/shading argument alignment and material mode | `test/worldKindShading.test.js` |
| Heat displacement envelope | `test/heatDistortionComposite.test.js` |
| World material light pixels | `npm run test:lighting` |
| Static shading containment | `npm run test:shading` |
| Whole-system effect lifecycle across seeks | `npm run test:seek` |
| Upload/playback/replacement/stop | `npm run test:smoke` |
| Nine-world selection/playback/seek/reduced motion and paint checks | `npm run test:worlds` |
| Uploaded-song chooser, pointer Preview/Play | `npm run test:chooser` |
| Desktop/narrow keyboard selection, native modality, Tab wrapping, Escape and focus return | `npm run test:chooser-keyboard` |

The reusable `.github/workflows/test.yml` runs lint, unit tests and all seven
browser commands above. Chooser checks run in their own job, and Pages
deployment depends on the entire validation workflow.
The world smoke explicitly rejects astronomical painting in Fathom/Nave.
Browser liveness, isolated pixel checks and unit tests do not establish
subjective appeal, exhaustive accessibility or real-device sustained FPS.

Still required:

- Human holdout reviews for appeal and musical timing. The checked-in holdout
  has eight tracks and zero reviews: `met: null`, `calibration: empty-holdout`.
  Do not claim the acceptance target has been met. See
  `docs/world-quality-evaluation.md` and `npm run eval:worlds -- --split holdout`.
- A device/scene matrix covering 1080p/4K, long tracks, sustained overload and
  recovery, plus complete simulation/audio/compositor costs. Repeated draws
  of one state measure JS submission only, not FPS or GPU completion.
- Per-world review of shared character outlines, trails, rings and bloom
  after the material-lighting fixes. Overlay dominance is an art-direction
  observation, not a demonstrated defect for every song.
- Manual screen-reader and broader assistive-technology review of the chooser,
  final-frame flash assessment, and a dedicated draw-order regression. Automated
  chooser tests cover keyboard behavior at 1280×800 and 390×844, not every
  browser/device or screen-reader combination. Current rendering tests cover
  individual drawables and lifecycle boundaries, not every ordering invariant.
