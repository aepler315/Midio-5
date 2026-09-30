# Midio-5 Landscape Performance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking. The user has requested this plan; production implementation is a subsequent task.

**Goal:** Make the landscape carry the music from the opening: remove the trio and incidental creature/vehicle scenes, strengthen Dancing Ridge and bass-driven mountain motion, couple the moon to the ridges, and create coherent, dramatic sunlight and moonlight.

**Architecture:** Keep the existing audio analysis, heard-time transport, RangeFrame adapter, shared terrain deformation and partitioned v2 renderer. Separate world presentation and musical expression from performer simulation; give ridge geometry and celestial lighting immutable shared samples. Build the lighting foundation before adding a small, optional solar-shaft pass.

**Tech Stack:** Existing JavaScript ES modules, Canvas 2D, the vendored Three.js/WebGL2 Range renderer, Node test runner and Playwright. No new analysis service, stem-separation model or rendering framework.

**Spec:** The Design brief and Tuning contract sections in this document form the design specification. Intended repository destination: `docs/superpowers/plans/2026-09-30-landscape-performance.md`.

**Reviewed baseline:** `aepler315/Midio-5@99cee063cd1b25667d5bf0def66da291104bd4ae`, the merge of #340. This document is a proposed design and implementation plan. No product changes, tests, performance measurements or PR are claimed.

## Design brief

The user's decision is to remove Midio, Broshi and Midasus because the landscape looks better without them. Remove the character opening as well as their final presence. Remove turtles, UFOs and the other incidental figures that spawn around ridges. Preserve real landscape vegetation, rocks, clouds, snow/ice, water and their scale cues.

Dancing Ridge becomes the quickest and most articulate gesture. The real mountains carry broad bass pressure and distinct kick accents. SpaceRidge remains slower and more distant. The moon answers the relationship between these two musical ridge systems. Sunlight and moonlight visibly change how the same geography reads.

This supersedes the character departure and handoff portions of the shared-world revelation design. There is no delayed scenic reward or compulsory character introduction. Musical expression belongs to the world from the first audible frame; changing presentation must not mute the source signals that previously drove the trio.

Range is the first complete artistic target. Apply the trio/decorative-actor removal policy through shared listening paths, including Canvas, its WebGL wrapper and fallback rendering. Preserve other worlds' terrain/material identities. Cathode has a separate pixel renderer and boss; it needs an explicit audit, but redesigning that world or deleting its defining boss is outside this Range plan.

Approaches considered:

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Strengthen the existing landscape systems and disconnect actors | Retains the established geography, depth and musical pipeline; smaller integration risk | Requires careful removal of hidden actor influences | Recommended |
| Retain the revelation opening and fade the trio earlier | Reuses the pilot directly | Contradicts the user's new removal decision | Superseded |
| Replace the scene with a new equalizer/shader stack | Complete freedom | Discards strong scenery and adds unnecessary renderer and analysis work | Reject |

The artistic aim is an inhabited musical landscape without literal performers. Broad terrain movement should preserve mountain mass and scale. Faster ridge articulation supplies excitement without speeding the entire camera or making every layer jump together.

## Verified integration findings

All links below point to the reviewed commit.

| Current behavior | Source | Consequence |
| --- | --- | --- |
| Revelation is opt-in; ordinary autoplay still includes the trio. The pilot also starts with the trio. | [main.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/main.js), [RangeNarrative.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/RangeNarrative.js) | Zeroing late cast opacity cannot implement immediate removal. |
| Actor simulation supplies origin coordinates and can trigger landing impulses, excursions, focus bids and camera fitting after bodies disappear. | [Simulation.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/sim/Simulation.js) | Replace the stage/origin dependency before removing actor construction and updates. |
| Bodies, burrow/voyage paths, brush, contact shadows, glow, mirror reflections and performer captures have separate draw paths. | [Renderer.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/render/Renderer.js) | Complete removal includes every actor contribution and its graphics resources. |
| Vignettes, near props, ocean life, murmuration and seeded massif bird/ship markers have separate ownership. Some are suppressed by the presence of a narrative object. | [BiomeManager.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/BiomeManager.js), [FarVignettes.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/FarVignettes.js) | Removing narrative state without a replacement policy can accidentally bring decoration back. |
| Dancing Ridge is the luminous horizon EQ, distinct from legacy MountainChoreo layer motion. | [RidgeComposition.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/RidgeComposition.js) | Tune the actual drawn ridge and measure its motion. |
| Its geographic skyline already has historical speedMul=3; spectrum advection and a traveling wave are separate motion sources. | [HorizonRidge.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/terrain/HorizonRidge.js) | Another 3x must be relative to this commit, across all three paths. |
| EQ and SpaceRidge smoothing depend on frame/update history. Fresh seeks can start with cold smoothing state. | [SpaceRidge.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/SpaceRidge.js), BiomeManager | Moon coupling must share deterministic ridge samples with painting. |
| v2 terrain already has shared musical displacement and normal correction; forest and depth shaders use the same field. Calibration targets about eight nominal pixels with a geological cap. | [RangeFrame.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/RangeFrame.js), [TerrainMaterial.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/TerrainMaterial.js) | Raise projected visibility and change the bass mix rather than merely multiplying raw metres. |
| Painted celestial bodies receive approach/parallax/tide offsets, while physical terrain light independently uses raw orbit coordinates. | BiomeManager, RangeFrame, [RangeScene.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/RangeScene.js) | Resolve one final position for body, cloud rims and physical key light. |
| Both sun/moon gaps can still receive direct lunar light because body selection and intensity floors ignore visibility. | RangeFrame and RangeScene | Gaps need zero direct celestial radiance and deliberately controlled ambient fill. |
| Forest and terrain already receive actual key/sky lighting. Existing Range composition disables decorative ray fans; targets lack sampled depth textures. | [ForestGL.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/ForestGL.js), [RangeSkyComposition.js](https://github.com/aepler315/Midio-5/blob/99cee063cd1b25667d5bf0def66da291104bd4ae/src/world/alpine/RangeSkyComposition.js) | Improve material lighting first. Occluded shafts require explicit depth/coverage work. |

Seven-band energy is spectral activity, not seven separated instruments. Use actual source-lane/note evidence where available; do not invent independent voices from shared fallback lanes.

## Global constraints

- Remove the trio and incidental creature/vehicle scenes from the default listening presentation from time zero, including silence, fallback, seek, replay and export.
- Preserve analyzed lane IDs internally where compatibility requires them; remove audience-facing character attribution.
- Preserve transport, upload/play/pause/restart/seek/export, accessible navigation and existing world/biome selection policy.
- Preserve the geographic terrain, shared displacement, glacier chronology, water receiver masks, forest roots, depth order and scene travel.
- Use heard time and causal inputs. Rendering never advances music, creates timed markers or consumes events.
- Use one musical sampling path for ridge drawing and moon coupling; one resolved celestial state for painting and illumination.
- Reduced motion removes geometry deformation and moon shake. Reduced flash removes rapid lighting accents; it does not silently disable all mountain movement.
- Do not change the scene camera's travel speed to satisfy ridge speed.
- Do not add a new full-song analysis wait just for the discarded reveal arc. Reuse existing analysis lifecycle and test the actual provisional/final handoff.
- Do not add a nostalgia selector, character return event, general cinematic editor or new audio analyzer.
- Essential geometry/light coherence survives quality reduction. Solar shafts shed first.
- Retain reserve-before-allocation and zero graphics overcommits; existing budgets are 256 MiB desktop and 128 MiB mobile.
- Numeric artistic values below are starting defaults for matched-video review, not measured guarantees.

## Tuning contract

### Dancing Ridge

The speed reference is the frozen reviewed main, not the older pre-speedup build.

| Control | Current | Proposed default |
| --- | --- | --- |
| Relative horizontal multiplier | 1 relative to reviewed main | 3; developer tuning range 2 to 5 |
| Geographic skyline speedMul | 3 | 9 at the default multiplier |
| EQ advection coefficient | 0.0018 times worldX | 0.0054 times worldX |
| Traveling wave phase rate | 1.6 radians/s | 4.8 radians/s |
| Real-crest wave coefficient at nominal 720p | 5 px | 18 px |
| Fallback wave coefficient at nominal 720p | 7 px | 24 px |
| Additional kick lift at nominal 720p | No separate dedicated lift here | Up to 24 px, scaled by crest and actual kick amplitude |
| Baseline / maximum band height / resting crest share | 0.60H / 0.40H / 0.40 | Keep initially |
| Headroom | Existing composition | Smoothly constrain the ridge above 0.12H |

Retain the existing approximately 80 ms kick attack and 340 ms exponential settle initially. Scale nominal pixel coefficients by logical viewport height/720, once. Keep the crest recognizable as it rises and releases. Stronger vertical movement must come from geometry, not additional glow.

Apply one constant scroll multiplier to all three motion paths. Changing an instantaneous multiplier against absolute worldX would create phase jumps; adaptive speed is deferred until a heard-time integrated phase exists.

The finite skyline scan fitter may shrink the visible window when travel increases. Keep finite, non-wrapping source data. Review framing at start/middle/end in every selected skyline. If a range becomes too tightly framed, choose a multiplier between 2 and 3 for that source while retaining its composition; do not fabricate repeated mountains or run off the scan. Record the effective multiplier in diagnostics.

### Real mountain motion

Use the existing sceneDeformation field and receiver masks. Start with a bass-emphasized pressure mix of:

`amplitudeM = (3 + 8*groove + 28*sustain) * scaleMul`

Here sustain already contains a low-band/bass contribution; it is not a separated bass instrument. Keep the genuine kick, melody, summit and structural channels distinct.

Change calibration from a fixed eight-pixel full-response target to:

`targetPx = 8 + 12*smoothstep(0.25, 0.90, activity01)`

The geological ceiling remains `min(180 metres, 0.065 * source relief)`. The ceiling wins when a distant/low-relief view cannot safely reach the projected target. Set `RANGE_MOTION_REFERENCE_M = 106.7`, the maximum of the proposed pressure mix and existing kick/gesture/melody/structural channels: `39*1.3 + 18 + 12 + 14 + 12`. Apply one gain `min(targetPx*metresPerPixel/referenceM, geologicalCap/referenceM)` to every channel. Preserve the existing nominal viewport/depth calculation. Do not divide by the current frame's instantaneous amplitude. Store the causal energy or genuine MIDI activity fallback as `frame.music.activity01`; silence-gate the geometry amplitudes and wave contributions so the constant pressure floor cannot invent musical movement.

Bass pressure is a broad, spatially coherent flex; kick accents lift and settle more quickly. Higher-frequency activity can articulate the luminous ridge without making the physical mountains answer every treble onset. Preserve anchored shores and water bodies, attached trees, corrected normals, and matching depth/outline displacement. Include summit mass rather than a uniform vertical translation.

Silence must release musical gestures. Normal scenic drift may continue according to the established transport, but there must be no fabricated drum motion. Keep slow camera coasting independent of musical impulses.

### Moon relationship

Sample animated and neutral ridge geometry at identical seed, authored shape, travel station, framing and heard time. Neutral means musical/decorative displacement removed; it does not mean the absolute zero-height skyline.

For fixed source-coordinate samples, compute signed upward displacement `neutralY - animatedY`. Use 64 equally weighted source samples for Dancing Ridge and the stable seeded node identities for SpaceRidge, independently of camera cropping. Divide each sample by its own design displacement bound, derived from fixed tuning and authored source shape, never current energy extrema. Reduce with a signed arithmetic mean and clamp to [-1,1]. For a crest-scaled Dancing sample, its bound carries the same authored crest factor as its displacement, so geographic scrolling alone cannot change the musical metric. Calculate a causal velocity using a 50 ms backward difference and bounded trailing smoothing.

Initial relationship:

`q = clamp(space.displacement01 - dance.displacement01, -1, 1)`

`v = clamp(space.velocity01 - dance.velocity01, -1, 1)`

`dy = 3*q; dx = 2*v` nominal pixels at 720p.

Scale once with the viewport, fade with moon horizon visibility, and enforce a six-pixel nominal vector bound. Larger shake can be considered after video review; it must retain the moon as a stable spatial landmark. Reduced motion produces zero offset.

The relationship excludes camera motion, absolute ridge altitude and ordinary skyline scrolling. Equal normalized ridge movement cancels; disagreement produces movement. The same final moon anchor must drive drawing and lighting.

### Sun and moon lighting

Keep the existing DayNight schedule initially: normal cycles are 100 to 200 seconds, with sun phase 0 to 0.42, dusk gap 0.42 to 0.50, moon 0.50 to 0.92 and dawn gap 0.92 to 1. This is an authored cycle, not a claim about the song's emotional meaning.

| State | Intended visible change |
| --- | --- |
| Day | Warm/white directional sun, readable brighter valleys, transmitted crown edges, clear sun glints on actual water |
| Dusk/dawn | Long-angle warm light, strong silhouette depth, gradual atmospheric color change |
| Moonlit night | Cool/pale directional light on facing mountains, snow, crowns and water; much darker shaded regions while retaining foreground readability |
| Empty celestial gap | No direct sun or moon key; restrained sky/ambient fill keeps geography legible |

Start solar direct gain at 1.6 and lunar direct gain at 0.25 in the existing scene's lighting scale. Multiply normal sky ambient by 1.0 by day and initially 0.35 at full night, interpolated smoothly. Add restrained solar foliage transmission with initial gain 0.18. Preserve the rock-stage legibility calibration as a separate receiver constraint; do not uniformly crush all fill.

These are relative artistic gains, not physical photometric ratios. Review exposure with moonlit water/snow and dark valley receivers. Do not counteract every nighttime reduction with automatic exposure until day and night look alike. Replace minimum direct-light floors with body visibility and use ambient fill for readability.

Sunlight through vegetation has two parts: actual crown/backface illumination in the existing forest shader, followed by atmospheric shafts through visible foliage openings. Screen-space shafts do not provide world-space tree-cast terrain shadows; a shadow atlas is separate future scope.

## File and interface map

New module names below are proposed; existing file paths are verified.

| File | Responsibility |
| --- | --- |
| Create src/world/LandscapePresentation.js | Resolve the default actor-free presentation and generic stage anchor |
| Create src/world/RidgeMotionHistory.js | Deterministic, heard-time ridge smoothing over existing curves/events |
| Create src/world/alpine/RidgeMotion.js | Pure animated/neutral ridge samples and their normalized relationship |
| Create src/world/CelestialState.js | One final approached/displaced celestial snapshot with visibility and radiance |
| Create src/world/alpine/SunShaftGL.js | Optional depth/coverage-based solar scattering |
| Modify Simulation.js and main.js | Remove actor ownership from listening initialization, stage origin, callbacks, focus and HUD |
| Modify Renderer.js and BiomeManager.js | Enforce absence across draw/update paths; consume shared ridge/celestial samples |
| Modify RangeFrame.js and RangeScene.js | Carry coherent world-owned music and lighting; calibrate and assign uniforms |
| Modify HorizonRidge.js and RidgeComposition.js | Apply bounded relative speed and stronger horizon geometry |
| Modify TerrainMaterial.js, ForestGL.js, RockStageGL.js and supporting uniforms | Shared illumination, foliage response and actual pool glints |
| Modify RangeQuality.js and GraphicsResidency.js only where needed | Shaft shedding and explicit resource accounting |

Proposed contracts:

- `resolveLandscapePresentation({worldId, stageWidth, stageHeight, groundY}) -> {mode:'landscape', cast:false, incidentalActors:false, stageAnchor:{originX, groundY}}`
- `new RidgeMotionHistory({energyCurves, timeline, response, durationMs, generation, stepMs:20})`
- `RidgeMotionHistory.sample(heardTimeMs) -> {generation, bands, spaceLevels, spaceDepths, kickMs, kickAmp, kick01, activity01}`
- `createRidgeMusicSampler({primary, previous:null, handoffStartMs:null, handoffDurationMs:500}) -> {sample(heardTimeMs), stateKey}`; both ridge evaluators accept this sampling interface. `kick01` is the already evaluated causal kick envelope, suitable for blending without applying its decay twice.
- `stateKey = {primaryGeneration, previousGeneration:null|id, handoffStartMs:null|number, handoffDurationMs:500}`; persist this immutable handoff record with song state and export.
- `sampleHorizonRidge({viewport, crest, songP, worldX, heardTimeMs, history, tuning, reducedMotion}) -> RidgeSample`
- `sampleSpaceRidge({viewport, seededGeometry, heardTimeMs, history, reducedMotion}) -> RidgeSample`
- `RidgeSample = {points, neutralPoints, displacement01, velocity01, boundPx}`
- `sampleRidgeRelationship({space, dance, nominalViewport, moonVisibility, reducedMotion}) -> {dxPx, dyPx}`
- `resolveCelestialState({timeMs, cycleMs, viewport, approach, moonOffset, nightFill, reducedMotion, reducedFlash}) -> CelestialState`
- `CelestialState = {sun, moon, activeBody:'sun'|'moon'|null, night01, ambientMultiplier}`
- Each sun/moon entry has `{xFrac,yFrac,radiusFrac,altitude01,visibility,directGain,colorHex}`; final fractions include approach and the bounded moon offset.
- `SunShaftGL.render({frame, coverage, sampledDepth, source, travelClip, quality}) -> transparent solar composite`, with `dispose()`.

The ridge evaluators receive `history` so they can sample the current and previous heard instants themselves. Velocity uses a 50 ms backward difference of the musical residual at identical source stations, with the current geometric travel/framing held fixed for that difference. Use a five-tap trailing mean at 0/20/40/60/80 ms for the normalized relationship; never sample future bins. At times between canonical ticks, start from the preceding tick and evaluate only the causal residual interval using source values at or before heard time. Do not interpolate a future canonical tick. Define each velocity normalization as one full design displacement per second before clamping to [-1,1].

Keep these small modules responsible for one concern. Do not give draw modules independent access to mutable Simulation data. RangeFrame remains the v2 adapter.

## Review focus

1. Fresh seek into dense music must show the same ridge geometry and moon anchor as sequential playback, including cold startup and export.
2. A removed performer must not retain focus bids, stage-origin authority, landing camera impulses, source callbacks or a graphics capture allocation.
3. Silent/quiet recordings and MIDI with shared or synthetic pitch sources must not gain fabricated beats, disappear completely, or double the same source.
4. Both empty celestial gaps must have zero direct radiance; final body and light anchors must agree through DPR, zoom, roll and overscan.
5. Travel, legacy fallback, context recovery and high quality must not restore actors or create unoccluded rays or residency overcommits.

Each concern is assigned to tests in the tasks below.

## Task 1: Make the landscape the default and retire actor ownership

**Files:** main.js, Simulation.js, Renderer.js, BiomeManager.js, RangeFrame.js, RangeNarrative.js, NarrativeDraw.js, PerformerCapture.js, source modules referenced by retired actor callbacks; new LandscapePresentation.js. Tests: new `test/landscapePresentation.test.js`, existing performerCapture, wetReflection, audibleTransport and revelation coverage.

**Interfaces:** Produces resolveLandscapePresentation and stageAnchor. Existing world transport/analysis remain available. A temporary deprecated pose alias may preserve renderer signatures while stage origins are migrated; it must not require constructing Midio.

- [ ] Add failing integration tests for actor/decorative absence at opening, silence, middle, final, seek/restart/export and fallback. Instrument actual construction, update, conductor subscriptions, draw, light emitter and capture ownership rather than only cast alpha.
- [ ] Run `node --test test/landscapePresentation.test.js test/performerCapture.test.js test/wetReflection.test.js test/audibleTransport.test.js`; confirm the new absence cases fail for the intended reason.
- [ ] Implement the explicit policy and generic stage origin. Disconnect actor constructor/update/event/focus/camera/landing paths after moving their required transport/world work. Replace score/fever-derived landscape intensity with world musical channels; leave tap synchronization functional.
- [ ] Remove all body, voyage/burrow, trails/brush, personal lights, shadows, mirror and capture contributions. Dispose retired performer capture resources. Preserve scenic water/sky reflection.
- [ ] Remove FarVignettes, massif bird/ship markers and incidental ocean/sky creatures. Filter near-field artificial/character props while preserving actual roots, stones, trees and baked terrain dressing. Stop render-time spawning.
- [ ] Replace narrative-dependent suppression with the explicit policy. Disconnect reveal handoff weights; keep source lane IDs compatible. Remove character lane badges and the obsolete pilot selector; old revelation URLs resolve to the new actor-free presentation.
- [ ] Run the focused tests and bootstrap/controls smoke. Commit the default landscape presentation once those pass.

Do not delete the entire narrative/audio-source module before preserving its useful causal lane lookup and pitch confidence behavior. Natural landscape assets are not equivalent to incidental actors.

## Task 2: Make ridge motion deterministic and source-owned

**Files:** new RidgeMotionHistory.js and alpine/RidgeMotion.js; VisualMusicHistory.js, BiomeManager.js, SpaceRidge.js, RangeFrame.js, main.js analysis lifecycle. Tests: new `test/ridgeMotionHistory.test.js`, existing seekLifecycle, audioLoadLifecycle and audioEvidence tests.

**Interfaces:** Consumes existing analyzed curves/events and presentation policy. Produces canonical ridge music samples and pure RidgeSample geometry for later tasks.

- [ ] Add failing cases comparing sequential playback, fresh seek, pause/repeated draws and export at the same heard time. Include low-level noise, quiet sustained music, MIDI tails, absent bands, shared source lanes and synthetic pitch.
- [ ] Run the focused test set and confirm current frame-history smoothing fails the equivalence cases.
- [ ] Implement canonical 20 ms causal attack/release smoothing using existing response constants. Index kick events through VisualMusicHistory. Store compact filter checkpoints at two-second intervals and replay at most 100 canonical steps per query; avoid one full per-node history array or replaying the whole song on every draw.
- [ ] Use the same immutable samples for EQ/SpaceRidge painting and neutral-relative measurements. Preserve seeded shape, node ordering and actual source pitch confidence. No future event/curve read at the requested time.
- [ ] Bind history ownership to the existing song/analysis generation. If initialization upgrades analysis mid-play, create the new sampler atomically with the previous and primary generation IDs, a handoff start at the current heard time and a 500 ms smoothstep blend of the resolved sample fields. Preserve both immutable histories and handoff metadata for the song session, fresh seeks, restarts and exports. Pausing freezes progress; seeking samples the recorded schedule rather than replaying an asynchronous arrival. Do not insert the reveal pilot's extra mandatory loading wait.
- [ ] Verify silent musical displacement releases, geometry freezes under reduced motion, and repeated draw does not alter samples. Commit canonical ridge sampling.

The generation handoff test must compare the same complete stateKey and analysis snapshots across playback, seek and export, including a seek inside the 500 ms blend. A newly loaded recording with only final analysis is a different stateKey and does not reproduce a former provisional handoff. Record the effective stateKey; do not claim the two inputs are identical.

## Task 3: Strengthen Dancing Ridge and bass-driven mountains

**Files:** HorizonRidge.js, RidgeComposition.js, RidgeMotion.js, BiomeManager.js, RangeFrame.js, TerrainMaterial.js, supporting shared uniforms. Tests: horizonRidge, ridgeComposition, rangeExpression, rangeShaderSource, receiver/forest coverage and new `test/landscapeMotion.test.js`.

**Interfaces:** Consumes RidgeMotionHistory and RidgeSample. Produces stronger geometry and per-view calibrated music using the Tuning contract.

- [ ] Add failing speed tests for geographic travel/window ratio, EQ advection and traveling wave phase, measured against the frozen baseline. Pin positive/leftward direction and finite source endpoints.
- [ ] Add failing vertical-excursion tests at fixed crest positions and camera, bass-versus-treble fixtures, kick release, silence release, smooth headroom and stable quiet-to-loud calibration. Keep receiver and CPU/GLSL parity assertions.
- [ ] Run `node --test test/horizonRidge.test.js test/ridgeComposition.test.js test/rangeExpression.test.js test/rangeShaderSource.test.js test/landscapeMotion.test.js` and confirm the new target cases fail.
- [ ] Apply the shared relative speed multiplier and vertical wave/kick values. Keep finite scans and composition; report effective per-source speed instead of claiming 3x where the fitter chose 2x.
- [ ] Change the bass pressure mix and projected calibration target. Use a stable reference bound; preserve the geological cap and receiver pinning. Update every terrain/depth/forest/outline consumer together.
- [ ] Verify matched two-second sequences with a fixed camera and then normal camera travel. A stationary-camera capture must show actual mountain deformation; a faster camera cannot satisfy this task. Commit the motion changes.

Do not tune legacy MountainChoreo's separate DANCE_LAYERS accidentally. Keep it as a supporting fallback path with bounded motion.

## Task 4: Couple the moon and unify celestial placement

**Files:** new CelestialState.js; RidgeMotion.js, DayNight.js, CelestialApproach.js, BiomeManager.js, RangeFrame.js, RangeScene.js, LightField.js, LightSpace.js, RangeSkyComposition.js and ground consumers. Tests: new `test/celestialState.test.js`, existing dayNight, celestialApproach, lightField, rangeFrame and landscapeDiagnostics.

**Interfaces:** Consumes both RidgeSamples; produces sampleRidgeRelationship and CelestialState. All downstream painting/material modules consume that final snapshot.

- [ ] Add failing tests for equal normalized ridge motion cancelling, one ridge moving relative to neutral, velocity sign, six-pixel bound, horizon fade and reduced-motion zero.
- [ ] Add failing anchor agreement tests across DPR, zoom, roll, portrait and overscan. Test both empty orbit gaps with activeBody=null and zero direct gains.
- [ ] Run the focused cases and confirm current independent orbit/light computation fails.
- [ ] Compute the pure relationship using fixed source identities, not current camera-visible averages or screen altitude differences. Use causal backward velocity and bounded trailing smoothing.
- [ ] Resolve final approached positions once before sky and v2 beginScenic. Make the moon disc, cloud rims, terrain/forest/world-water key and ground key consume the same anchor. Use recorded transforms to convert scenic/ground coordinates once.
- [ ] Remove the old independent tide-only moon offset and hidden-body light floors. Ambient light remains separately controlled in gaps.
- [ ] Verify pause/seek/export equality and stable light directions through sunrise/sunset. Commit shared celestial state.

## Task 5: Make day, dusk and moonlight change the actual surfaces

**Files:** TerrainMaterial.js, ForestGL.js, RockStageGL.js, RangeScene.js, RangeFrame.js, TerrainGL.js where uniforms are declared, RangeAtmosphere.js only as necessary. Tests: new `test/landscapeLighting.test.js`, rangeShaderSource, rangeFrame, forestCover, groundMaterial and v2 browser fixtures.

**Interfaces:** Consumes CelestialState, world music and receiver geometry. Produces shared material lighting, restrained foliage transmission and celestial water glints.

- [ ] Add failing receiver tests for facing versus shaded mountains, warm sun versus cool moon, night ambient interpolation, zero direct light in gaps and real pool glints. Preserve readable stage constraints.
- [ ] Run unit tests and an actual v2 fixed-camera receiver fixture; distinguish numeric uniform tests from rendered pixel outcomes.
- [ ] Apply the tuning gains, separate body colors from biome halo tint, and compose sky/air/mist colors consistently. Keep direct gain proportional to actual visibility.
- [ ] Add solar-only crown/backface response for mesh trees and alpha-tested billboard edges. Give distant canopy its existing texture-based directional response; do not invent distant individual branches.
- [ ] Add the same resolved celestial direction to existing rock-stage pool glints, clipped to actual pools. Preserve world-water receiver masks and scenic reflection; performer capture stays absent.
- [ ] Capture matched day/dusk/gap/moon frames and short videos. Night must retain ridge separation and valley/forest legibility while visibly changing facing-surface highlights and shadow contrast. Commit coherent surface lighting.

## Task 6: Add sunlight through foliage with bounded cost

**Files:** new SunShaftGL.js; RangeScene.js, RangePresentation.js, RangeQuality.js and GraphicsResidency integration; ForestGL depth/coverage twins as required. Tests: new `test/sunShaft.test.js`, rangeSceneLifecycle, rangeSceneTransition, rangeQuality and graphicsResidency.

**Interfaces:** Consumes CelestialState, the same deforming forest/terrain silhouettes and scene travel clipping. Produces an optional transparent solar composite; it does not own sky motion or physical key light.

- [ ] Add failing fixtures: fully closed occluder produces no shafts; openings produce patterned light; behind opaque near terrain contributes no foreground wash; moon/gaps produce no solar shafts.
- [ ] Run unit tests plus a v2 scene fixture and confirm no existing decorative fan is accepted as the implementation.
- [ ] Add sampled depth/coverage explicitly; existing depth buffers are not textures. Start with quarter-resolution resources, cap the shaft target's long edge at 512 pixels, and reserve all live A/B attachments before allocation.
- [ ] Reuse alpha-tested forest coverage and matching wind/deformation. Composite with depth-aware air/coverage rules at the actual scenic pass boundaries. Respect each travel side's clipping and the existing inserted Dancing Ridge order.
- [ ] Disable shafts first under budget denial or quality level 3 and above. Keep base solar/lunar material illumination. Dispose attachments on context loss, view retirement and renderer disposal.
- [ ] Verify travel, context loss/recovery and residency with shafts enabled/disabled. Commit the optional occluded solar effect.

This is screen-space atmospheric scattering through visible foliage gaps. World-space tree-cast terrain shadows, cascaded shadow maps and volumetric raymarching are deferred.

## Task 7: Validate the complete experience and update guidance

**Files:** new `tools/landscape-performance-smoke.mjs`; extend `tools/range-scene-smoke.mjs` and relevant existing export/seek harnesses; update revelation-era documentation and add `docs/evidence/landscape-performance/README.md`.

**Interfaces:** Exercises the actual assembled default presentation and records renderer/source generation, seed, camera, motion, lighting, resource ownership and runtime errors.

- [ ] Add default-load checks proving immediate cast absence and playable controls without opting into revelation. Rewrite obsolete assertions expecting opening/gameplay cast.
- [ ] Add a v2 evidence matrix: landscape/portrait, DPR 1/2, quiet/dense/MIDI/silence, day/dusk/gap/moon, fixed/normal camera, seek/restart/export, travel, legacy fallback and context recovery.
- [ ] Run `npm test`, `npm run lint`, `git diff --check`, `node tools/build-range-runtime.mjs --check` and `npm run stage:site`. Investigate failures before completion claims.
- [ ] Start the existing local server and run the new performance smoke, bootstrap, seek and export checks against that exact served branch. The existing adapted-lighting and legacy landscape checks alone do not prove v2 lighting.
- [ ] Save before/after clips with matched song/seed/time/camera/quality. Include 15-to-30-second sequences, not only stills. Use short pop, dense metal, long progressive, quiet atmospheric and genuine MIDI lanes.
- [ ] Record real desktop and Android timing/residency where hardware is available. Otherwise explicitly mark hardware acceptance unverified; software GL and emulation are visual/correctness evidence only.
- [ ] Review the branch for actor remnants, disconnected audio channels, doubled smoothing, phase jumps, receiver motion, hidden lunar light and unoccluded shaft overlays. Update docs and commit evidence only after checking its provenance.

## Completion criteria

| Requirement | Required evidence |
| --- | --- |
| Complete removal | No bodies, trails, private lights, shadows, actor reflections/captures, excursions, decorative actors or hidden actor camera/focus effects from opening through export/fallback |
| Musical continuity | Actual bass and phrase fixtures still move the world; causal source IDs and pitch confidence are retained |
| Faster Dancing Ridge | Every applicable motion path measures an effective 2x to 5x frozen-baseline horizontal speed in the same direction, with finite source endpoints |
| Vertical drama | Fixed-camera videos show stronger crest waves and independent kick rise/release; headroom/composition survive peaks |
| Dancing mountains | Bass produces visible coherent deformation with attached vegetation, stable shores and correct shading/depth, without exceeding geological bounds |
| Relational moon | Equal normalized ridge movement cancels; differing self-relative movement produces bounded, repeatable shake |
| Coherent day/night | One final celestial anchor lights real receivers; gaps have no direct key; night remains legible and visibly distinct |
| Vegetation sunlight | Real foliage gets solar backlighting; shafts follow actual visible gaps and occlusion, never a permanent decorative fan |
| Reproducibility | Same analyzed generation and heard time give matching playback/seek/pause/export ridge and celestial state |
| Cost | No overcommit; shafts shed first; real-device targets retain desktop steady p95 <=20 ms, phone <=34 ms and travel <=1.5x steady where measured |

## Delivery sequence

Keep seven reviewable commits but integrate them as one coherent feature branch. Task 1 produces the clean scene; Tasks 2 and 3 make the land convincingly musical; Tasks 4 and 5 make the sky/light relationship coherent; Task 6 adds the expensive flourish; Task 7 verifies the assembled result.

Implementation should re-read the latest main and relevant repository instructions before editing. Reconcile any intervening work against this frozen baseline instead of blindly applying line numbers. Open a PR only when requested by the implementation task, with actual test results and clear hardware limitations.

The first artistic comparison should answer three questions: Does the landscape visibly carry the song? Does stronger motion preserve the mountains' scale? Does day/night change the world enough to feel consequential? Those judgments require matched moving evidence after implementation.

