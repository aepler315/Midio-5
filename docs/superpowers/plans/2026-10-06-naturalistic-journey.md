# Naturalistic Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Journey's cartoon landforms, lake and routine motion with a coherent, grounded musical landscape.

**Architecture:** Retain the existing continuous CPU/GLSL world field, compact render graph and angular cast. Improve four independently owned areas, integrate them on one feature branch, and validate actual rendered output. Workers use separate worktrees and preserve the interfaces below.

**Tech Stack:** JavaScript modules, Three.js vendored runtime, WebGL2 GLSL, Node test runner, Playwright capture.

**Spec:** `docs/superpowers/specs/2026-10-06-naturalistic-journey.md`

## Global Constraints

- Preserve clear-sky star/constellation artwork, density, twinkle and styling.
- Keep heard-time determinism, held frames, backward seeking, reload/context restoration, reduced motion and reduced flash.
- Preserve the trio, sunset/moonlight/sunrise, continuous travel, two ranges, geographic view selection and existing output/display modes.
- No new production dependencies; retain bounded mesh and GPU ownership.
- Use the same shore field for land, water, trees, dressing and contacts; CPU and GLSL must agree.
- Implement only the active Journey improvements in the spec; no unrelated world or UI changes.
- Each worker edits only its owned files, runs its targeted regressions, and reports tests and commit IDs. The controller runs the complete integrated suite and visual checks.

## Review Focus

- Long songs and seeks: spatial pose and shore geometry are pure functions of heard time and seed (Tasks 1–4).
- Silence and missing source/section data: calm living motion without automatic spectacles; no NaN or camera jump (Tasks 2, 4).
- Strong energy changes: planted feet cannot slide, swim masks cannot leak, and shore interpolation remains subpixel (Tasks 1, 2).
- Small/asymmetric output aspects: default full-body framing and bounded expressive camera accommodation (Task 4).
- Weather and accessibility: shared sky/reflection/receiver state, no flashes under reduced flash, no time-driven motion under reduced motion (Tasks 3, 4).

## Shared Interfaces

- Existing JourneyWorld exports and `sampleJourneyState({timeMs,seed,music,reducedMotion})` retain their signatures and field meanings. Task 1 owns camera's neutral authored constants in `JOURNEY_VIEW`; Task 4 accommodates them, without editing that file.
- Existing JourneyMaterial exports retain signatures. Task 3 may export `journeyDressing(THREE, uniforms)` returning one owned mesh; Task 4 adds it to `p.meshes` and `p.scene`, including disposal and memory accounting.
- Existing `uStorm` is Vector4(amount, flash, break01, wet01). Task 4 sets it and existing `uFirmamentWeather` Vector2(amount, flash), with reduced-flash policy. Task 3 consumes these in shading. If directional Journey weather needs opt-in, Task 3 adds `uJourneyWeatherEnable` and `uJourneyClearing` scalar uniforms to `firmamentUniforms`, defaults 0; Task 4 sets 1 and break01 respectively.
- Task 4 introduces `sampleJourneyDirection({timeMs, sections, durationMs, music, reducedMotion})` in `JourneyDirection.js`. It returns `{phase, intensity01, accent01, focusId, cameraMove}`; phase is quiet/build/arrival/sustain/recovery, focusId is null/midio/broshi/midasus. `cameraMove` follows existing RangeCamera move shape. Frame data carries this as `journeyDirection`, only used by Journey.
- Task 2 adds optional `direction = null` to `sampleJourneyCast`. It uses `direction.phase`, `intensity01`, `accent01`, `focusId` when present, and retains sensible source-driven defaults otherwise. No phase accumulation or live-value time multiplication.

### Task 1: Coherent terrain and basin

**Owned files:** `src/world/alpine/JourneyWorld.js`, `JourneyMountains.js`, `test/journeyWorld.test.js`, `test/journeyMountains.test.js`.

**Interfaces:** Preserve existing world/surface functions and returned state shape. Cast and shaders consume them without private duplicated shore logic. Coordinate any neutral camera change with Task 4.

- [ ] Add meaningful failing geometry tests for reduced high-frequency basin breathing, irregular asymmetric coves, and distinguishable front-range depth structure. Preserve exact lake tips, finite long-time samples, nonnegative depth and continuous normals.
- [ ] Run `node --test test/journeyWorld.test.js test/journeyMountains.test.js` and record the intended failures.
- [ ] Improve basin/ground/mountain macros. Slow coordinated geography evolution must still reveal new coves; remove direct energy-driven basin inflation. Avoid generic detail-noise amplification. Add integrated shallow shelves/foreground relief via existing common height functions. Keep GLSL twins exact.
- [ ] Run owned tests plus `test/journeyIntegration.test.js`; fix contact/interpolation regressions, communicate changed assumptions to other workers.
- [ ] Commit only owned files and write task report.

### Task 2: Weight and musical character movement

**Owned files:** `src/world/alpine/JourneyCast.js`, `CoveGL.js`, `test/journeyCast.test.js`, `test/rangeCoveGL.test.js`.

**Interfaces:** Retain CoveGL-compatible pose shape; optional direction parameter as above. Preserve footOffsetsM/contact/wake receiver contracts. Import existing world functions instead of duplicating geography. Task 4 handles camera framing.

- [ ] Replace tests that require spectacular motion in silence with behavioral tests for restrained continuous locomotion, substantially stronger musical gestures, bounded changes, deterministic seeks, planted feet, and reduced-motion/reduced-flash independence.
- [ ] Run owned tests and observe failures before changing motion.
- [ ] Implement purposeful curved paths and smooth acceleration, physical stroke/stride timing and contact gestures. Baseline movement remains visible. Gate leaps/dives/large rolls with sustained activity/phrase/accent evidence; avoid multiplying absolute time by live energy. Keep torso/foot contacts and wakes correct. Improve filled character facets without increasing all outline emission or changing glyph identity.
- [ ] Run owned tests and `test/rangePerformanceIntegration.test.js`, reporting any changed baseline expectations.
- [ ] Commit only owned files and write task report.

### Task 3: Water, land materials and habitat detail

**Owned files:** `src/world/alpine/JourneyMaterial.js`, optional new `JourneyDressing.js`/`JourneyWeatherGL.js`, `FirmamentGL.js` only for weather wrapping/uniforms (not star routines), new `test/journeyMaterial.test.js`, new `test/journeyHabitatDetail.test.js`.

**Interfaces:** Preserve exports; add optional journeyDressing export if implemented. Use common JourneyWorld GLSL for contact. Consume existing uStorm and shared firmament weather; define opt-in weather scalars as above if needed. Task 4 owns scene wiring and tests.

- [ ] Add failing tests for deterministic bounded habitat geometry with multiple crown shapes/clustered placement, and shared weather/material wiring using actual uniforms/material construction. Do not make source-text tests the only evidence for shader behavior.
- [ ] Run these tests and record failures.
- [ ] Remove continuous luminous lake perimeter. Use low normal-incidence Fresnel, depth/shallows absorption, irregular wind patches, perspective-correct reflections with restrained roughness breakup, and contact wakes. Keep reflected stars visible at grazing angles and no opaque screen-space reflection hacks.
- [ ] Improve slope/material/air separation and wet-ground/lightning/clearing response. Add shared directional storm cloud coverage in firmament radiance and water, gated to Journey so other scene behavior is preserved. Do not modify clear-sky star functions or artwork.
- [ ] Add sparse shoreline stones/reeds and clustered varied conifers with bounded draw calls, common surface roots, and correct normals/contact. Add wet edge/material patches rather than uniform noise density.
- [ ] Run new tests plus `test/journeyIntegration.test.js`, `test/rangeFirmament.test.js`, `test/rangeStars.test.js`. Actual shader/render validation follows integration.
- [ ] Commit only owned files and write task report.

### Task 4: Weather, phrase staging and safe camera integration

**Owned files:** `src/world/alpine/JourneyScene.js`, `RangeFrame.js`, new `JourneyDirection.js`, new `test/journeyDirection.test.js`, new `test/journeyWeather.test.js`, `test/journeyIntegration.test.js`, `test/journeyLifecycle.test.js`.

**Interfaces:** Produce direction contract above; RangeFrame passes all sections to pure sampler then exposes result. JourneyScene passes direction to sampleJourneyCast. Use existing applyCameraMoves and listener controls. Integrate Task 3's dressing and weather uniforms.

- [ ] Add failing tests for the 48-second full-body framing defect, complete excursions over multiple seeds/aspects, section-aware deterministic moves, quiet/missing data, shared weather uniforms, and reduced-motion/flash behavior.
- [ ] Run relevant tests and observe intended failures.
- [ ] Add bounded musical direction with smooth preparation/arrival/sustain/recovery envelopes. Use detected sections and continuous source data; repeated motifs remain related. Avoid beat-following camera bob. Pullbacks/arcs reveal high-energy sections; foreground/melodic focus can push in with safe limits.
- [ ] Correct default framing using conservative cast extents and aspect-aware camera staging. Preserve listener camera control and terrain clearance. Ensure auto framing does not frame-by-frame chase footsteps or distort character scale.
- [ ] Populate uStorm, uFirmamentWeather and Journey opt-in uniforms consistently; adjust key/fill and weather receiver state once per frame. Integrate dressing ownership and shadow/reflection contact. Reduce competing aurora/companions only when a clear foreground subject leads, without changing star density/art.
- [ ] Run direction/weather/integration/lifecycle tests plus `test/rangeFrame.test.js` and `test/rangePerformanceCamera.test.js`.
- [ ] Commit only owned files and write task report.

### Task 5: Rendered acceptance and integration

**Owned files:** reusable `tools/journey-naturalism-evidence.mjs`, `docs/evidence/journey-naturalism/README.md` and compact report/media; plan checklist and README status if necessary. Source fixes return to their owners.

- [ ] Capture baseline with the existing pilot and seed at the specified times and a short motion sequence. Investigate browser availability once; use available supported Chromium dependencies without changing product dependencies.
- [ ] Integrate reviewed task commits and run `npm test`, lint, and site staging.
- [ ] Capture matching after frames, a short motion sequence, square/portrait stages and controlled weather. Inspect images at normal size and check full silhouettes, water continuity, physical contacts, terrain separation and coherent receiver flashes.
- [ ] Record actual command results and output identities. Fix any shader/lifecycle/regression problems through owning workers and recheck the affected cases.
- [ ] Publish a feature branch and a reviewable PR with concise behavior/verification notes and visual evidence. Do not merge or deploy unless separately authorized.
