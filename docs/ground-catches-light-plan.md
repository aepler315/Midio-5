# The Ground Catches It — the last surfaces the light doesn't reach

## Context

**This is an audit + architecture document, not an implementation.** Two things are delivered
here: a survey of the visual-effects suite as it stands on `main` today, and an upgrade package
architected off that survey, specified in enough detail (exact files, line numbers, function
signatures, reasoning, test criteria) that an implementer who has none of this session's context
can carry it out.

It is the direct successor to `docs/finish-the-light-plan.md` (PR #58, merged 2026-08-13), which
connected the celestial light to contact shadows, mountain facets, and particles. That package
closed every gap it named. This one names what it left.

**Baseline verified on `main` @ `37adb9f`:** `src/world/` 39 files / 11,243 lines,
`src/render/` 20 files / 3,965 lines, 139 test files, **1,404 assertions green** (`npm test`).

---

## The audit

### What the light currently reaches

Since PR #57 and #58, `LightField.computeLight()` (`src/render/LightField.js:27`) is resolved once
per frame in `BiomeManager.draw()` (`:1342`), stashed on `this.light`, and consumed by four
surfaces:

| Surface | Mechanism | Where |
| --- | --- | --- |
| Character wireframes | Per-edge rim light with radius falloff (`litMeta` loop) | `MeshDrawer.js:120-145` |
| Character contact shadows | Ellipse thrown along `lightDirTo`, horizon-stretched | `ContactShadow.js:45` |
| Mountain facets (L2–L5) | `shoulderFacetSide(stripX, lightX, summitX)` | `BiomeManager.js:154`, used `:3465` |
| Particles / weather | Proximity alpha wash, bounded at `PARTICLE_LIGHT_CAP` | `ParticleField.js:20` |

Secondary sources exist and are wired: `groundGlowLights()` (kick pulses) and
`characterGlowLight()` (Midasus's core), assembled per-frame at `Renderer.js:249-260` and again
for particles at `BiomeManager.js:1489-1497`. The whole stack sheds on the `PerfGovernor` ladder
(`rimLightEnabled` at level ≥ 2, `contactShadowsEnabled` at ≥ 3).

Unlike the previous audit, **there is no dead lighting code left.** I re-ran the same checks: every
exported symbol in `LightField.js` now has a consumer, `contactShadowsEnabled` genuinely gates the
three `_drawContactShadow` calls, and a sweep for exported-but-unreferenced symbols across
`src/`, `test/`, and `tools/` turns up only tuning constants and test seams — nothing structural.
The previous package's premise ("code written, tested, then never wired") no longer holds.

### What the light does *not* reach

So this package's finding is a different shape. Verified by reading each site, not by grep alone:

| Evidence | Verdict |
| --- | --- |
| `_drawGround` (`BiomeManager.js:3735`) | **The ground plane is a flat fill.** `ctx.fillStyle = groundColor; ctx.fill(fillPath)` at `:3775`, and the crest is a fixed `rgba(255,255,255,0.18)` stroke at `:3879` — the same brightness whether the sun is directly overhead or setting behind it. |
| `_drawTerrainFooting` (`:1555`) | The only shading the ground band has is **ambient**: three stacked black AO strokes along the ridge line (`TERRAIN_FOOTING_AO_PASSES`, `:77`). Direction-independent by construction. |
| `_drawRidgeVolume` (`:3381`) vs. the ground | The *mountains* get a crest-catch / foot-sink gradient **and** sun-facing facets. The ground — nearer, larger, and the surface the whole cast stands on — gets neither. It is the flattest surface in the frame while being the one the eye spends most time on. |
| `ObstacleSpawner.draw` (`src/sim/ObstacleSpawner.js:223`) | **Zero occurrences of "shadow" in the file.** Every obstacle sits on the ground at `cy = groundY - o.height / 2` (`:257`) and casts nothing, while the three characters standing on that same ground all do. Things that share a floor should share its rules. |
| `_drawHaze` (`:1621`) | **The atmosphere doesn't know where the light is.** One vertical `createLinearGradient(0, 0, 0, canvas.height)`, zero horizontal component. `DepthHaze.js` contains one occurrence of the word "light" and it's in the module title. |

The through-line: **the light is fully modelled in the air and on the wireframes, and completely
absent from the ground plane, the objects standing on it, and the air's own directional
scattering.** Three surfaces, one omission.

### Dropped from scope, with reasons

- **True cast shadows from the mountains onto the ground.** Tempting and wrong here. Each parallax
  layer scrolls at its own ratio (`LAYER_RATIOS`, `BiomeManager.js:71` — L2 at 0.10, the ground at
  1.00), so a summit's position and a ground bar's position are not expressed in a common world
  space. There is no geometrically honest projection between them to compute; anything built would
  be a fake dressed as physics, which is the failure mode this codebase consistently avoids.
- **Obstacles as light *emitters*.** Obstacles already draw additively in `haloColor`
  (`ObstacleSpawner.js:260`), so feeding them into the `lights` array is superficially attractive.
  Cost is the problem: N obstacles × M mesh edges × 3 characters, every frame, for a glow that is
  already visible on its own. Revisit only if the lights array grows a spatial cull.
- **Film grain, tone mapping, WebGL.** Dropped by the previous audit for reasons that still hold;
  `WebGLRenderer.js` remains an opt-in decorative overlay, not a renderer.

---

## The package — three changes, one theme

Every item extends an existing pure function or adds one in that style: numbers in, plain object
out, caller owns `ctx`. Every item is backward compatible by construction — **omit the light and
the output is byte-identical to today's** — which is the discipline that made PR #57 and #58 safe
and is what the first test in each group should pin down.

### 1. Terrain relief — the ground plane responds to the light

**New module: `src/world/TerrainRelief.js`.** Pure, no drawing, mirroring `ContactShadow.js`'s
shape (a handful of exported constants plus one function, everything testable in `node --test`).

```js
/**
 * Per-bar surface facing against a light, for the ground ridge.
 * @param {Array<{x:number,width:number,y:number}>} bars  GroundField.visibleBars() output (screen space)
 * @param {(null|{x:number,y:number,intensity:number})} light
 * @returns {number[]} one value per bar in -1..1: +1 fully facing the light,
 *   -1 fully turned away, 0 edge-on. All zeros when `light` is null/degenerate,
 *   which is what makes every consumer's "no light" path the current look.
 */
export function terrainFacing(bars, light)
```

Implementation: for bar `i`, take the local tangent from its neighbours' top-centre points
(`bars[i+1]` minus `bars[i-1]`, clamped at the ends), rotate it to the outward normal — canvas y
grows downward and the solid is *below* the curve, so the outward normal is the one with the
negative y component — normalize `(light.x - barCx, light.y - barY)` to get the direction to the
light, and dot the two. Scale the result by `clamp01(light.intensity)` so the relief fades out with
the light itself (the coda's `unravel` already drives `intensity` to 0, so the ground goes flat as
the world comes apart, for free).

**Two consumers in `_drawGround`,** both inside the existing `if (this.groundField && !isLake)`
branch so the lake surface — deliberately still, flat water — is untouched:

- **Relief body pass**, immediately after the flat fill at `:3775`. Clip to `fillPath` (exactly as
  `_drawRidgeVolume` clips to `body` at `:3401`) and paint a per-bar column, lifted toward
  `SHOULDER_LIT` (`#fff8e6`, `:138`) where facing is positive and sunk toward `#000` where it is
  negative. Reuse those two colours literally: `_drawShoulders` already argues (`:3440-3443`) why
  neutral shading beats a tinted one across seventeen palettes, and that argument transfers intact.
  Keep the peak coefficients at or below the mountains' own (`0.17` lit / `0.32` shade,
  `:3422-3424`) — the ground is nearer and larger, so equal coefficients read as *more*.
- **Crest catch**, replacing the uniform `rgba(255,255,255,0.18)` stroke at `:3879` with a
  per-segment alpha of `0.18 * (1 + k * facing[i])`. This is the pass that reads instantly: the
  rim of each hump brightens on the sun's side and dims on the other as the celestial arcs across
  the song. Segment the stroke, don't stroke the whole path N times.

**Perf:** gate the whole item on `rimLightEnabled` (level < 2). `visibleBars()` returns roughly
`screenWidth / sliceWidth` entries — about 25 on a 2240px stage — so this is ~25 short fills plus
~25 short strokes, the same order as `_drawShoulders`. It is per-bar work keyed off the light,
which is precisely what that rung already means.

### 2. Obstacles get contact shadows

`contactShadow()` (`ContactShadow.js:45`) is already pure, already light-aware, and already
produces exactly the ellipse this needs. No new geometry code — only a call site.

**In `ObstacleSpawner`,** add a pure method returning what to shadow, so the Renderer stays a
compositor and the safety rules stay next to the spawner that owns them:

```js
/** Grounded obstacles worth a contact shadow, in screen space. `groundYAt`
 *  is a worldX -> y function (GroundField.heightAt, remapped) so a shadow
 *  sits on the real terrain under its obstacle rather than on one flat
 *  reference line -- the same fix PR #58 made for rain splashes. */
groundedShadows(worldX, originX, groundYAt)
```

Return `{ x, width, groundY, presence }` per obstacle, applying the same visibility rules
`draw()` already uses at `:233-255` (screen cull, `emergence * dissolve`). **Restrict to the
solid archetypes — `thorn`, `geo`, `pipe`.** `veil` is a drifting sheet and `echo` is a mote
cloud; neither is an object that would occlude anything, and shadowing them would read as a bug.
That exclusion is the one judgement call in this item and it belongs in a named constant with a
comment, not inline.

**In `Renderer.draw`,** immediately before `sim.obstacles.draw(...)` at `:274` (shadows must paint
under their owner, the same ordering rule the character shadows follow at `:292`/`:309`/`:334`):

```js
if (contactShadowsEnabled && sim.obstacles) {
  for (const o of sim.obstacles.groundedShadows(pose.worldX, pose.midioX, groundYAt)) {
    const s = contactShadow(o.x, o.groundY, 0, o.width, light);
    this._drawContactShadow(ctx, { ...s, alpha: s.alpha * o.presence });
  }
}
```

Scaling alpha by `presence` is what makes the shadow condense and dissolve with the obstacle
instead of popping in under a shape that isn't there yet. `heightAbove` is `0` because every
archetype is grounded — which means these shadows never fade with height, they only slide and
stretch as the celestial moves, exactly like a real object's.

**Perf:** the existing `contactShadowsEnabled` gate, no new rung. Worst case a handful of extra
ellipse fills.

### 3. Forward scattering — the air brightens toward the light

**In `DepthHaze.js`,** one new pure function beside `hazeAlpha`:

```js
/** The scatter halo for one haze layer: real atmosphere is far brighter
 *  looking toward the light than away from it (forward scattering), which is
 *  the strongest single cue that a landscape is lit rather than tinted.
 *  Returns null -- a hard skip, no fill -- with no light, no intensity, or a
 *  layer that carries no haze. */
export function hazeScatter(layerKey, light, hazeMul = 1, canvasHeight = 0)
  // -> {cx, cy, radius, alpha} | null
```

`alpha` scales with `HAZE_LAYER_FRAC[layerKey]` (the far layers sit behind more air, so they
scatter more), `light.intensity`, and `hazeMul`; `radius` scales off `canvasHeight`. Cap it low —
`HAZE_SCATTER_MAX` in the neighbourhood of `HAZE_BASE_ALPHA` — because this stacks across up to
three layers and the frame already carries a bloom pass.

**In `_drawHaze` (`:1621`),** after the existing vertical fill, draw one additive radial gradient
in the `hazeColor` already computed at `:1627`, centred on the returned `cx`/`cy` and fading to
transparent at `radius`. This is one extra `fill()` per haze layer, using a colour and an alpha
the function already had in hand.

**Perf:** free-riding on the existing `hazeLayers` rung (`PerfGovernor:hazeLayers`), which already
collapses three haze layers to one at level ≥ 6 — the extra fill dies with the layer it belongs to.

---

## Files

**New:**
- `src/world/TerrainRelief.js` — `terrainFacing()` + constants, pure
- `test/terrainRelief.test.js`
- `test/obstacleShadow.test.js`

**Modified:**
- `src/world/BiomeManager.js` — relief body + crest catch in `_drawGround` (`:3775`, `:3879`); scatter fill in `_drawHaze` (`:1621`)
- `src/world/DepthHaze.js` — `hazeScatter()` + its constants
- `src/sim/ObstacleSpawner.js` — `groundedShadows()`
- `src/render/Renderer.js` — the obstacle-shadow loop before `:274`
- `test/depthHaze.test.js`, `test/obstacles.test.js` — extend in place

**Reused, not reinvented:** `contactShadow()` and its whole calibrated constant set,
`_drawContactShadow` (`Renderer.js:878`), `GroundField.visibleBars()` / `heightAt()`,
`_terrainTopPath()`, `SHOULDER_LIT` and the neutral-shading argument at `BiomeManager.js:3440`,
`HAZE_LAYER_FRAC`, `PerfGovernor.rimLightEnabled` / `contactShadowsEnabled` / `hazeLayers`.

---

## Sequencing

Branch fresh from `main` (currently `37adb9f`, PR #58 merged). Nothing here depends on unmerged
work. Before starting, confirm `main` still contains `this.light` in `BiomeManager.draw()` and the
flat `ctx.fillStyle = groundColor` fill in `_drawGround` — if a later PR has already shaded the
ground, item 1 needs re-scoping rather than re-implementing.

The three items are independent and can land in one PR or three. If split, order them **1, 2, 3**:
item 1 is the one that changes the frame's overall look, so it wants the most screenshot time and
the least contention with the others.

---

## Verification

**Unit** (`node --test`, flat `test()` calls — **1,404 currently green, all must stay green**):

- `terrainFacing(bars, null)` returns all zeros — the regression guard that makes every "no light"
  path identical to today. Write this one first.
- Facing flips sign when the light crosses a slope's vertical: a bar on a rising slope reads
  positive with the light on its uphill side and negative with the light mirrored.
- Facing is exactly 0 on flat terrain with the light directly overhead, and bounded to [-1, 1] for
  every input, including single-bar and two-bar arrays (the end-clamp path).
- Facing scales to 0 as `light.intensity` does.
- `groundedShadows()` excludes `veil` and `echo`, excludes off-screen obstacles, and reports
  `presence` matching `emergenceEnvelope * dissolveEnvelope` for the same inputs `draw()` sees.
- A grounded obstacle's shadow `cx` tracks a mocked light across the sky, and its alpha scales
  linearly with `presence`.
- `hazeScatter()` returns `null` for `L5` (zero haze frac), for a null light, and for zero
  intensity; alpha is monotonic in `light.intensity` and never exceeds `HAZE_SCATTER_MAX`.

**Visual, in a real browser** — Playwright against the dev server (`node tools/serve.js`, port
8080; Chromium at `/opt/pw-browsers/chromium`), sampling **canvas pixels**, not eyeballing:

- **Item 1's acceptance criterion:** freeze all world state, drive the day-night clock across a
  full arc, and assert the mean luminance of the ground band's left half and right half
  *cross over*. A ground that looks the same at sunrise and sunset is the exact failure this item
  exists to fix, and a static screenshot will not catch it.
- Item 2: screenshot a frame containing a `pipe` and confirm a dark ellipse at its base that
  translates when the light moves. Confirm no ellipse appears under a `veil`.
- Item 3: sample pixels either side of the celestial's screen x within the haze band and assert
  the sun-side is brighter. Confirm the effect survives, visibly reduced, under `?perf=lite`.
- Across all three: no console errors, and `?perf=lite` and `?perf=high` both render.

**Scratch-file discipline** (house convention): verification scripts named `scratch_*.mjs` /
`.png` at repo root, `rm -f`'d before committing; dev server stopped
(`pkill -f "tools/serve.js"`) when done.

---

## Deliverables

1. **The audit** — captured above: the inventory, the confirmation that the previous package's
   dead-code findings are fully closed, the five pieces of evidence for the ground/objects/air
   omission, and the dropped-scope calls with their reasoning.
2. **The implementation** — the three numbered changes across `src/world/TerrainRelief.js` (new),
   `src/world/BiomeManager.js`, `src/world/DepthHaze.js`, `src/sim/ObstacleSpawner.js`, and
   `src/render/Renderer.js`, verified per "Verification", on a branch off current `main`.

This plan file is the only artifact this session produces. Publishing the audit or the plan as a
claude.ai artifact is optional and out of scope unless asked for separately.
