# Glacial Valley Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Independent asset and presentation work can use superpowers:dispatching-parallel-agents with exclusive file ownership.

**Goal:** Reveal a real Pend Oreille valley through song-driven ice retreat and aerial camera motion, with persistent water, richer stars and a clean frame.

**Architecture:** Extend optional SceneView metadata and heard-time camera sampling. A shared glacier field raises terrain in scenic/depth shaders and excludes buried forest; the terrain material supplies ice and wet-margin detail. Presentation fixes remain separate from scene geometry.

**Tech Stack:** JavaScript ES modules, Three/WebGL2, Canvas2D, Node tests, Playwright, existing DEM bake tools.

**Spec:** docs/superpowers/specs/2026-09-29-glacial-valley-flight-design.md

## Global Constraints
- No new runtime dependencies.
- Retreat is monotonic in heard song time.
- Existing scenes retain their geography.
- Pause, seeking in either direction, export, quality and DPR cannot change the state at a given song time.
- Do not merge or deploy.

## Review Focus
- Unknown/zero duration: stable preview without NaNs.
- Ordinary views: zero ice displacement and unchanged camera endpoints.
- New curved rail: full-traverse frustum coverage, finite look vectors and peak visibility.
- Song restart/seek: deterministic glacier and forest recovery, no accumulated retreat.
- Hidden seekbar: no invisible hit targets; keyboard/debug paths remain available.

### Task 1: Pend Oreille terrain pilot
**Files:** data/terrain/scenic-views.json, src/assets/range/v2/terrain/pend-oreille-valley.*, src/world/terrain/sceneCatalogData.js, tools/build-range-scene.mjs, test/glacialSceneCatalog.test.mjs.
**Interfaces:** Produces optional `view.glacier` metadata containing `axisStartM`, `axisEndM` (XZ metre pairs), `halfWidthM`, `surfaceStartM`, `surfaceEndM`, and `maxThicknessM`. Optional `camera.eyeArcM` and `camera.targetArcM` are XYZ metre offsets at the midpoint of the rail. Curves must remain inside the terrain bake corridor.
- [ ] Write and observe failing tests for metadata preservation and pilot coordinates.
- [ ] Bake a real DEM view of the Newport–Cusick–Ione valley corridor with source provenance and valid camera coverage; retain candidate status pending visual evidence.
- [ ] Preserve optional glacier/camera metadata in runtime catalog and approval hashes.
- [ ] Run catalog/build tests; commit only owned paths.

### Task 2: Glacier field and curved flight
**Files:** src/world/alpine/GlacierField.js, src/world/alpine/TerrainMaterial.js, src/world/alpine/ForestGL.js, src/world/alpine/RangeScene.js, src/world/alpine/RangeFrame.js, src/world/terrain/SceneTravel.js, corresponding focused tests.
**Interfaces:** `glacierStateAt({timeMs,durationMs,progress01})` returns `{retreat01}`; `glacierSample(config,x,z,bedM,retreat01)` returns `{thicknessM,surfaceM,coverage01,recovery01}`. GLSL and CPU share equations. Scene uniforms get glacier parameters and heard-time retreat; non-glacier views use disabled uniforms.
- [ ] Write and observe failing tests for finite preview, monotonic retreat, positive bounded thickness, zero end ice, local foliage recovery and ordinary-view parity.
- [ ] Implement the field and optional bounded curved camera offsets; test start/mid/end and degenerate curve rejection.
- [ ] Use identical glacier displacement in terrain/depth passes; hide buried trees in color/depth and apply exposure-delayed recovery. Shade ice, crevasses and debris while leaving exposed water level.
- [ ] Run affected tests and lint; commit.

### Task 3: Persistent water, stars and clean presentation
**Files:** src/world/BiomeManager.js, src/world/StarCatalogue.js, src/world/alpine/RangeSkyComposition.js, src/render/Renderer.js, src/main.js, src/world/alpine/RockStage.js, focused tests.
**Interfaces:** Existing Canvas painter passes; `hudInFrame` false means seek hit testing is disabled. Stars retain shared angular drift and fractional brightness; water draws outside the hazard condition.
- [ ] Reproduce water suppression and seekbar hit targets; add meaningful regression tests.
- [ ] Restore ordinary ocean pass; replace one-in-five rejection with spatial attenuation, richer clusters and granular galaxy detail.
- [ ] Disable seekbar painting and hit tests, minimize walking foreground without changing physics.
- [ ] Run focused tests and lint; commit only owned paths.

### Task 4: Render and review
**Files:** tools/glacial-flight-smoke.mjs, docs/glacial-valley-validation.md, docs/evidence/glacial-valley/.
- [ ] Run full tests, lint and site staging; inspect outcomes.
- [ ] Render Trains at 150–159 seconds, opening and closing states, plus standard views. Check shader errors, pause/re-render parity, foliage exclusion, water, flight framing and context restore.
- [ ] Approve the pilot only if measured catalog/framing gates and inspected evidence pass; otherwise retain candidate and document exact URL.
- [ ] Request one fresh whole-branch review, repair material findings, and open a PR with exact validation limits.
