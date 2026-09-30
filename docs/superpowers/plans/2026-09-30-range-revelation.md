# Range revelation implementation plan

> Historical plan: the later [landscape performance plan](../plans/2026-09-30-landscape-performance.md) supersedes actor introduction/departure, optional gameplay presentation and the extra full-analysis wait. Current behavior and evidence are documented in [landscape performance validation](../../evidence/landscape-performance/README.md).


**Goal:** Implement the supplied opt-in Range listening arc, preserving gameplay and transport.
**Architecture:** Compile one immutable song schedule in Simulation; sample at heard time into RangeFrame. Use the existing terrain, depth prepass and shared glacier/deformation vertex shader for material revelation and sparse source-space ink. Central cast weights feed all visual paths; source activity persists in ridge, terrain and atmosphere consumers.
**Tech stack:** ES modules, Canvas2D, Three.js GLSL3, node:test, Playwright.
**Spec:** ../specs/2026-09-30-range-revelation-design.md

## Global constraints
- Range-only opt-in; gameplay remains the default.
- Revelation uses the spec's Q/U/P/r formula and channel intervals; silence holds.
- Same indexed state on seek, repeated draw, export and renderer fallback.
- No independent fabricated lanes or synthetic pitch authority.
- One geography and depth order; no additional full-resolution scene target.
- Pressure capped at .32; combined film edge capped at .40. Respect reduced motion/flash.

## Review focus
Silence floor on quiet recordings; long notes without curves; body alpha overwritten inside draw helpers; context recovery/legacy fallback; GPU ink depth and resident byte accounting.

## Task 1: Compile and sample musical narrative
Files: src/world/alpine/RangeNarrative.js, test/rangeNarrative.test.js.
Produces: compileRangeNarrative({durationMs, energyCurves, timeline, sections, barGrid, casting}); schedule.sample(timeMs) -> immutable channels, cast weights, lane envelopes and pressure.
Write tests for formula, monotonic/silent progression, notes-only and empty sources, snapshot ownership, backward seek, detected boundaries, lane fallback and pitch provenance. Run RED, implement, run GREEN.

## Task 2: Own schedule and presentation selection
Files: Simulation.js, RangeFrame.js, main.js, index.html; integration tests.
Simulation owns the schedule once per song and exposes rangeNarrativeAt(timeMs), returning null outside the listening pilot/Range. Bind an accessible settings select and URL override. Combine narrative and excursion participation centrally. BuildRangeFrame carries narrative and source envelopes, resolves coherent sky, weights physical music without changing receiver masks. Test gameplay/default, export and fallback semantics.

## Task 3: Reveal the same terrain and sky
Files: TerrainFeatures.js, TerrainMaterial.js, RangeScene.js, ForestInstances.js, RockStageGL.js, BiomeManager.js; GPU and numeric tests.
Extract bounded geological feature segments from the loaded triangle geometry; share displacement shader and depth prepass, budget/release their GPU memory. Stage relief, atmosphere, material and feature channels independently. Resolve Canvas/GPU sky together, weight ridge source expression, retain a simplified legacy presentation. Test geometry budget/identity, uniform defaults and depth. Render opening, overlap and final in real WebGL.

## Task 4: Finish departure and validation
Files: Renderer.js, FilmFinish.js, narrative drawing helper, tests and smoke tool.
Cover bodies/captures/reflections/shadows/lights/brush/afterimages/excursions/decorative figures; suppress gameplay-only demands. Add bounded source-linked indexed traces and shared void marks. Compose essential pressure with optional film effects. Test zero cast at final, single reflection fade, caps and reduced policies. Run full suite/lint, browser captures including legacy and recovery; review whole branch, fix findings and open PR.
