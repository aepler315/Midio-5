# Range stage performance implementation plan

> For agentic workers: use executing-plans for integration, with independent component workers and a final code review.

**Goal:** Deliver the passive trio on a platform beside a laterally travelling 3D Range lake.

**Architecture:** Reuse the canonical musical history and retained mesh kit.
A dedicated `trioStage` presentation flag enables the new pure Canvas layer;
old gameplay ownership stays disabled. The Range frame carries a steady
camera policy and musical lake hits to the existing geographic water shader.

**Tech stack:** JavaScript ES modules, Canvas2D, existing Three/WebGL terrain,
Node tests and Playwright.

**Spec:** ../specs/2026-10-05-range-stage-performance.md

## Global constraints

- Use heard time and canonical history; preserve confidence, silence and handoff rules.
- Retain existing sunset/moonlight/sunrise, dense stars and source-specific ridge responses.
- Default only Range to the stage; other worlds and explicit scenery-only mode retain their ownership.
- Do not revive gameplay or allocate cast capture surfaces.
- Keep real lake masks, shore receivers, quality fallback and user zoom.

## Review focus

- Source-role fallback on MIDI without audio bands must not give Broshi a melody response.
- Backward seek and late analysis adoption must reconstruct identical poses and preserve continuity.
- Portrait/letterbox and low-quality output must keep the whole trio inside the picture.
- Terrain camera and sky/reflection camera must share the same lateral pose.
- Reduced motion and reduced flash must control different visual channels.

## Tasks

1. **Canonical trio sampling and painter**
   - [x] Add role-correct trio sources to RidgeMotionHistory and handoff blending.
   - [x] Add `sampleRangePerformance({timeMs,music,width,height,reducedMotion,reducedFlash})` and `drawRangePerformance(ctx,frame,{light})` in `src/world/alpine/RangePerformance.js`.
   - [x] Exercise independent source fixtures, silence, pitch confidence, seek/handoff, draw ownership and bounds.
2. **Lateral camera and geographic lake**
   - [x] Add a performance camera policy to RangeFrame, RangeScene and RangePresentation's shared sky path.
   - [x] Preserve fixed viewing direction during lateral travel, user zoom and safety clearance.
   - [x] Bind performance-only conductor hit rings within TerrainMaterial's water mask, with quality/accessibility bounds.
   - [x] Test camera determinism, pose parity and final shader inputs.
3. **Default presentation integration**
   - [x] Resolve `performance|landscape` once at startup and pass through Simulation.
   - [x] Add the dedicated stage flag; integrate the painter in Renderer before finish/captions.
   - [x] Default the auto pilot to Muncho Lake while respecting explicit view selections.
   - [x] Keep old performer effects and inhabited-sea ownership disabled; suppress old wandering Range figures in performance.
   - [x] Run actual compositor and other-world regression tests.
4. **Evidence and review**
   - [x] Run full tests/lint and real browser captures with source identity.
   - [x] Fix visual composition and any review findings.
   - [x] Record evidence and prepare the draft PR description.

Baseline: 3,744 tests passed on main `7383b3b`; no failures.

Final: 3,784 tests passed, lint and diff checks passed. Production browser
evidence and served source identity are in `docs/evidence/range-performance/`.
Music, camera, lake-fix and final sky reviews have no remaining blockers.
