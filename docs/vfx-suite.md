# Visual Effects Suite — Spec Sheet

The VFX suite is everything the game draws that is *not* world geometry and
*not* a character: the impact vocabulary, the trails, the post-processing
stack, and the two cross-cutting systems (accessibility, perf) that every
effect is obligated to respect.

Everything here is a **pure consumer of the NoteEvent timeline and the sim
state** — no effect owns gameplay state, and no effect reads audio directly.
Directors compute numbers; the Renderer draws them.

---

## 1. Inventory

### 1.1 Impact vocabulary — `src/sim/ImpactFX.js`

Landing/judgment fan-out. Positions stored in **world space** (`wx`) so a
short-lived burst stays glued to its ground point while the world scrolls;
mapped to screen at draw time via `wx - worldX + originX`.

| Sub-effect | Pool cap | Life | Trigger |
| --- | --- | --- | --- |
| Crater flash (radial gradient, ellipse squash 0.4) | 16 | 0.12 s | every landing |
| Dust ring (24-segment jittered ellipse) | 16 | 0.42 s | every landing |
| Dust motes (gravity 300 px/s²) | 400 | 0.26–0.42 s | landing, sputter, judgment |
| Star-polygon shockwave (5–7 points, spinning, 3-lobe wobble) | 8 | 0.5 s | landing with `I > 0.5` |
| Paint splat (6–9 chunky squares, 1 of 6 paint-pot colors) | 20 | 2.8 s | rhythm-clean landing |
| Ignition ring (gold, `lighter`) | 8 | 0.5 s | any landing while Apotheosis is active |
| Ground scar (decal) | 60 (manual cap) | 4 s | every landing |

**Intensity law.** `I = clamp(vLand / vRef, 0, 1) ^ 0.7` — the single
normalized 0..1 scalar that scales radius, alpha, mote count, and camera
shake (`camera.shake(5.5 * I)`).

**Judgment ring colors** are the verdict; the shape is language-free:

| Tier | RGB | Radius | Motes | Direction |
| --- | --- | --- | --- | --- |
| `perfect` | `255,215,106` | 150 | 10 | rising |
| `great` | `79,216,196` | 110 | 6 | rising |
| `good` | `235,235,245` | 75 | 3 | rising |
| `sour` | `158,132,168` | 55 | 8 | drooping, 7px jag |

**Telegraph sputter** runs at a fixed ~120 motes/sec accumulator during
pre-kick anticipation.

### 1.2 Ripple — `src/sim/RippleFX.js`

The ground's *answer* to a landing, drawn additively (`lighter`) with the
same world-space convention and a fixed `RIPPLE_SQUASH = 0.28` perspective.
Every curve is a **pure exported function**, which is why this is the one
impact module with real unit tests.

- `rippleRadius(ageMs, I)` — ease-out cubic to `60 + 180·I` px
- `rippleLifeMs(I)` — `700 + 300·I` ms
- `rippleAlpha(ageMs, I)` — `(0.5 + 0.3·I)·(1-u)²`
- `groundPulseX(ageMs, I)` — twin ground-line pulses, ease-out to `90 + 160·I` px
- `puffOffset(ageMs, angle, I)` / `puffAlpha(ageMs, I)` — biome-tinted landing puff, `PUFF_LIFE_MS = 480`

3 rings stagger at 90 ms. The puff takes its color from
`BiomeManager.currentParticleColor()` — the puff itself does not know dust
from snow from ember from splash.

### 1.3 Rainbow brush — `src/render/RainbowBrush.js`

Mario-Paint pen repurposed: while Midio is airborne, chunky square dabs drop
at 8 px stroke spacing, hue stepping 16°/dab, world-locked, `MAX_DABS = 320`,
`LIFE_MS = 3200`. Additive at peak alpha 0.4 (deliberately low — additive
stacking saturates to white fast). Spacing widens by `1/particleMul` under
perf pressure; size doubles during Apotheosis.

### 1.4 Post-processing stack

Applied to the fully composed frame, in this fixed order:

1. **Fever aura** (`_drawFeverAura`) — inverse vignette, silent below
   `fever = 0.55`, ramps to alpha 0.22, tinted to the biome halo.
2. **Hype frame** (`_drawHypeFrame`) — breathing border + kick strobe +
   frame-echo self-blit on hard hits.
3. **Drop impact pack** (`_drawDropImpact`) — chromatic shock
   (`≤ 8 px` offset, `≤ 0.5` alpha) + 24 radial speed lines (`≤ 0.35` alpha).
4. **Bloom** (`_drawBloom`) — 1/3-res downsample → 2 self-multiply threshold
   passes (`c^4`) → 7 px blur → additive upscale blit. Strength from
   `bloomStrength(hype, fever, reducedFlash, openingGain)`; early-out below 0.005.
5. **Film finish** (`_drawFilmFinish`) — `soft-light` grade wash (alpha
   `0.012 + 0.03·|warmth-0.5|·2`, hard-capped at 0.22) + optional indigo space
   wash + `source-over` vignette (alpha `0.02 → 0.54`, onset `0.62 → 0.34`).
6. HUD strip draws **after** post-FX so nothing buries it.

**`FilmFinish` state model** (`src/render/FilmFinish.js`) — two one-pole
smoothed 0..1 signals:

- `vignetteDepth`, τ = 0.6 s. Target = `calm · (1 - 0.85·hypeOpen)` —
  proportional, never subtractive, so it can't undershoot.
  `hypeOpen = surge + 0.35·slam + 0.20·fast`.
- `warmth`, τ = 1.2 s. Target = `0.5·(1-calm) + 0.5·budget`.
- `hit(kind)` bypasses the lowpass entirely for authored cuts:
  `drop→0.05`, `apotheosis→0.95`, `finale→0`, `quake→0.2`, `tsunami→0.05`.

### 1.5 Lighting — `src/render/LightField.js`

Pure data, no drawing. One celestial light resolved per frame and shared by
every rim light and contact shadow:

`intensity = budget · (1 - unravel) · (1 - 0.5·dayArcAlpha)`

Secondary lights are local and falloff-limited — they light who's nearby,
they don't relight the world: ground-glow pulses (radius 130 px, ×0.55) and
character glow (radius 100 px). Both are empty-in/empty-out (zero cost when
nothing is active).

### 1.6 Color law — `src/render/ColorLaw.js`

Three protected hues, never rotated by biome or key, never angle-nudged,
never blended:

- `MIDIO_IDENTITY_HUE = 178` — who he is
- `HAZARD_HEX = #ff4d4d` — what will hurt you
- `REWARD_HEX = #ffd75e` — what you did right

### 1.7 House dials — `src/render/VisualStyle.js`

One look, one dial set. VFX-relevant multipliers: `bloomBaseMul 1.4`,
`filmGradeMul 1.45`, `vignetteDepthMul 1.08`, `glowHaloMul 1.55`,
`rimAmount 0.95`, `spaceWash true`.

---

## 2. Cross-cutting contracts

### 2.1 Accessibility — `src/ui/Accessibility.js`

`reducedFlash` is a persisted toggle that defaults to
`prefers-reduced-motion` when the player has never chosen. Contract:
**every flashing alpha routes through `capFlashAlpha(alpha, reducedFlash)`**,
which clamps to `FLASH_CAP = 0.4`.

Two effects opt out deliberately and document why:

- The film finish never routes through it — neither channel spikes on a
  kick, so it is a swell, not a flash.
- `LightField.computeLight` *compresses toward a 0.6 baseline* instead of
  capping, since a continuous light has no peak to clamp.

The hype frame's echo self-blit is disabled outright under reduced flash.

### 2.2 Performance — `src/render/PerfGovernor.js`

A 7-level (0..6) shed ladder with hysteresis. Budget 15 ms.

**Shed:** each over-budget frame accumulates `min(6, delta/15)`; at 60
accumulated units, shed one rung. A frame at exactly budget takes ~1 s to
shed; a 3× frame takes ~20.
**Recover:** one rung per 10 clean seconds.
**Start level:** `?perf=lite` → 2, `?perf=high` → 0, otherwise coarse-pointer
or small viewport → 1.

| Level | What is lost |
| --- | --- |
| 1 | vision self-tuning loop |
| 2 | particle count ×0.6, rim light |
| 3 | contact shadows, crack glow, **bloom** |
| 4 | L7 foreground veil |
| 5 | optional phenomena (reaction-diffusion, cymatics, murmuration, planets, far vignettes, meteors) |
| 6 | haze layers 3→1, **film grade + vignette**, hype frame echo |

`particleMul` reaches effects two ways: directly from `perf.particleMul`, and
multiplied by fever headroom in the sim (`perf.particleMul · (1 + 1.5·fever)`).

### 2.3 Allocation discipline

Every burst effect uses `ObjectPool` (`src/utils/ObjectPool.js`) — prefilled
free list, hard capacity cap, `spawn()` **returns `null`** when full,
`step(dt, fn)` reclaims on `fn → false`. Zero allocation in the hot loop once
warm. Scars are the documented exception (small list, seconds-long life,
manual `shift()` cap at 60).

---

## 3. Draw order (the actual contract)

Effects are not free to draw anywhere; the order below is load-bearing.

```
sky / parallax / phenomena          [zoomed transform]
──── groundView.apply() ──────────  [fixed zoom=1 transform, everything below]
ground, footing, flood
burrow
desaturation overlay (Coda)         ← touches only the world painted so far
telegraph
obstacle contact shadows, obstacles
ImpactFX                            ← world-space bursts
RippleFX
battle enemies
RainbowBrush                        ← behind the characters
contact shadows + characters (Broshi, Midio, Midasus)
epicycles (combo milestone)
drop shockwave
character reflections
battle FX, gnat
foreground veil (L7)
fracture cracks                     ← the screen's own glass, above all world layers
transposition wave
──── ctx.restore() ───────────────
[opening-assembly frame capture]    ← clean world composite, pre-post-FX
fever aura → hype frame → drop impact
──── identity transform ──────────
bloom → film finish
HUD seekbar                         ← after post-FX, never buried
assembly shards
[freeze capture] · [highlight reel capture]
```

Two capture points depend on this order: the opening assembly grabs a clean
world composite *before* post-FX; the highlight reel grabs the *fully*
composed frame including HUD.

---

## 4. Verification

| Covered by unit tests | Not covered |
| --- | --- |
| `rippleFX.test.js` (pure curve functions) | `ImpactFX` — no test file at all |
| `filmFinish.test.js` (targets, smoothing, hits) | `RainbowBrush` |
| `lightField.test.js` | `_drawFilmFinish` / `_drawFeverAura` / `_drawDropImpact` |
| `perf-governor.test.js`, `perfGovernorConsumers.test.js` | bloom pipeline (only `bloomStrength` is tested) |
| `accessibility.test.js`, `colorLaw.test.js` | draw-order regressions |
| `visualStyle.test.js` (incl. `bloomStrength`) | |

E2E: `tools/smoke.mjs` (screenshot sequence), `tools/smoke-fracture.mjs`,
`tools/smoke-full.mjs`.

---

## 5. Review — how this suite should improve

Ordered by severity. Items 1–3 are defects; 4–7 are design gaps.

### 5.1 `ImpactFX` can throw when its ring pool is full — **bug**

`ObjectPool.spawn()` returns `null` at capacity, and both ring call sites
dereference the result immediately:

```js
const ring = this.rings.spawn({ ... });   // ImpactFX.js:39, :109
for (let i = 0; i < 24; i++) ring.jitter[i] = ...;   // TypeError if null
```

The ring pool holds 16; ring life is 0.38–0.42 s. Sixteen concurrent rings
means roughly 38 landings-plus-judgments per second — reachable in a dense
passage with judgment rings firing per note. Because `main.js` wraps the draw
in a try/catch, the throw would silently kill the rest of the frame rather
than surface. **Fix:** null-guard both sites (`if (!ring) return;` /
`if (ring) { … }`), and consider raising the ring cap to match the mote pool's
generosity. Add the same guard as a lint-visible convention wherever
`spawn()`'s return value is used.

### 5.2 `ImpactFX` ignores `reducedFlash` entirely — **accessibility gap**

`capFlashAlpha` is imported by 16 files. `ImpactFX.js` is not one of them,
and `Renderer.js:301` calls `sim.impactFX.draw(ctx, worldX, originX)` with no
flash argument at all — while the very next line passes it to `RippleFX`.
So the crater flash (alpha 0.85), the judgment rings, and the gold ignition
ring (additive `lighter`) all run at full strength for a player who
explicitly asked for reduced flash. This is the single most flash-heavy
module in the game and it is the one module exempt from the toggle.
**Fix:** thread `reducedFlash` into `ImpactFX.draw` and wrap crater, ring,
polyRing and ignition alphas.

### 5.3 A single clean frame wipes the shed accumulator — **perf logic**

```js
} else { this._overCount = 0; ... }   // PerfGovernor.js:67
```

Alternating over/under frames — the classic "hovering just above budget"
pattern that produces visible judder — never accumulates 60 units and so
never sheds a rung. The severity weighting added for badly-blown frames
doesn't help here, because the counter resets before it can build. **Fix:**
decay rather than reset (`this._overCount *= 0.9` or subtract a fixed unit),
so sustained judder eventually sheds while a single clean hitch still
doesn't.

### 5.4 The flash cap doesn't survive additive stacking

`capFlashAlpha` clamps each layer at 0.4 independently, but ripple rings,
ground pulses, puffs, brush dabs, ignition rings, bloom and the hype echo all
composite with `lighter`. Six capped layers still sum to white. The cap is a
per-call promise the composite mode breaks. **Fix:** give reduced-flash a
frame-level budget — either a global additive-alpha multiplier applied once
in the Renderer, or suppress the additive composite mode itself (fall back to
`source-over`) when the toggle is on.

### 5.5 `particleMul` is applied inconsistently

`trigger()` and `judgment()` take it; `sputter()` (fixed 120 motes/sec),
`splat()` (fixed 6–9 blobs) and `RippleFX.trigger()` (fixed 3 rings) do not.
On a level-2 shed device the headline bursts thin out by 40% while the
continuous telegraph sputter keeps its full spawn rate — the opposite of the
right priority, since sputter is ambient and the landing burst is feedback.
**Fix:** route every spawn site through the same multiplier, and consider
inverting the weighting so ambient effects shed *before* feedback effects.

### 5.6 `ImpactFX` is untested, and is the module most in need of tests

`RippleFX` was written with its curves as pure exported functions and is
tested; `ImpactFX` keeps the identical math inline in `trigger()`/`draw()`
and has no test file. The intensity law, the tier→style table, and the pool
lifecycle are all trivially testable. **Fix:** extract `craterRadius(I)`,
`ringRadius(age, tau, Rd)`, `moteCount(I, particleMul)` and the tier table as
pure exports, mirroring `RippleFX`'s shape, then test them — this also makes
5.1 and 5.5 regressions catchable.

### 5.7 Draw order is a comment, not a contract

Section 3 above is reconstructed by reading `Renderer.draw()` top to bottom. The comments are unusually good, and several of them
record real bugs that were fixed (the non-cancelling shake translate, the
`drawImage` on a logical stage view that silently killed whole frames). But
nothing *enforces* the order, and two frame captures depend on it. **Fix:**
a `rendererDrawOrder.test.js` that drives a stub context recording call
order and asserts the load-bearing invariants — foreground veil before
fracture, HUD after post-FX, assembly capture before bloom.

### 5.8 Smaller notes

- `new ImpactFX()` takes a seed but is always constructed with the default
  `1`, so splat colors and mote spread replay identically for every song. If
  that's deliberate (determinism for the smoke tests), say so in the comment;
  if not, seed it from the song.
- `PerfGovernor`'s header documents two spec rungs that were never built
  (crossfade memoization, per-pixel crack refraction) and explains what was
  substituted. That's the right call, but the honesty belongs in the spec
  too — as of now this doc is the only place both halves are written down.
- The ladder never sheds `RainbowBrush`, which at 320 dabs is a real
  per-frame cost during a dense flurry. It widens spacing via `particleMul`
  but is never gated. Level 4 or 5 is the natural home for it.
