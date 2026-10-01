# Midio-5 coherent terrain performance implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for the tightly coupled core work, or `superpowers:subagent-driven-development` task by task. Steps use checkboxes for tracking. Parallelize evidence collection and independent review; keep shared rendering edits sequential.

**Goal:** make the shipped Range terrain read as one geographically coherent, actor-free landscape that responds clearly to the song and reconstructs correctly after seeking and export.

**Architecture:** extend the existing immutable musical history and RangeFrame. Keep the DEM renderer, approved-view selection, camera rails, shared deformation, celestial lighting, graphics ledger and fallback. Remove the unconditional inhabited shore, correct temporal discontinuities, then improve foreground, water and projected response on three pilot views before extending the result to the approved catalog.

**Tech stack:** JavaScript ES modules, Canvas 2D, the existing vendored Three/WebGL2 runtime and GLSL, Node test runner, Playwright evidence harnesses, existing terrain authoring/build tools. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-coherent-terrain.md`, especially its design brief. Keep both files together. At implementation start, place the spec and plan under the repository's `docs/superpowers/specs/` and `docs/superpowers/plans/` conventions if desired.

**Reviewed baseline:** `c7c22e850a92bdea6313653ab03903f587e03e28`. Re-read subsequent commits before executing; do not overwrite newer intentional changes or rebuild completed work. This deliverable authorizes no deployment or merge by itself.

## Execution status — 2026-10-01

Tasks 1–6 have implementation and automated regression coverage. Task 7 has source-bound CPU evidence, full tests, lint, dependency-based staging, HTTP delivery and resolved independent review. Browser captures, decoded export, real-song artistic review and physical devices remain pending; original unchecked acceptance steps below are retained for continuation. See `docs/evidence/terrain-continuation/README.md`.

Plan adaptation: keep the 13 original approvals and add forced `teton-jackson-lake-coherent` / `monument-valley-163-coherent` variants sharing existing terrain assets; otherwise candidating the only CONIFER/DESERT scenes breaks catalog coverage. Pend stays candidate. No new geographic package, global gain or catalog approval was added.

## Global constraints

- Default listening is actor-free from time zero, including silence, replay, seeking, legacy fallback and export. Retain Cathode's separate boss behavior.
- Preserve source-specific 2×/3× ridge travel. No additional blanket multiplier.
- Keep one song-owned immutable history and recorded 500 ms analysis handoff; no renderer-owned event accumulation.
- Keep physical deformation at or below the existing 180 m and 6.5% relief ceilings; hydro receivers and shoreline shoulders remain pinned.
- Preserve far terrain → Dancing Ridge → mid terrain → near terrain depth order and SpaceRidge's independent sky role.
- No universal bottom-third sea. Inland water remains inland; dry views remain dry.
- Initial pilot foreground coverage is at most 12% of nominal height; source terrain must cover the revealed lower frame.
- No second full-resolution landscape or reflection pipeline in this iteration. No new terrain collection, analyzer, narrative mode or biome/chapter rewrite.
- Retain current 256 MiB desktop / 128 MiB mobile ownership budgets and quality degradation behavior.
- Pend Oreille stays `candidate`, explicitly forced for review. Approval hashes cannot be carried forward over changed camera/material/composition content.
- Phone viewport testing preserves the existing 16:9 letterboxed stage. Arbitrary output dimensions must use uniform fitting; an authored portrait camera is out of scope.

## Review focus

1. Asymmetric frequency content after cold/backward seek or analysis adoption: actual ridge points must match sequential playback (Task 2).
2. A loud passage ending in digital silence, and a quiet/noisy file from the beginning: release should be smooth without invented activity (Task 3).
3. A dry or glacial view during fallback, flood, shake, roll and A/B travel: no invented sea, empty frame band, resident pixels or misplaced overlay (Tasks 1 and 4).
4. Portrait export versus a portrait phone viewport: preserve object proportions and document the different framing contracts (Task 4).
5. Low-memory two-view travel and context recovery: preserve signatures and actual renderer identity without budget overflow or persistent fallback (Task 7).

## Execution order and deliverables

| Delivery | Tasks | Reviewable outcome |
|---|---|---|
| A — coherent baseline | 1–3 | Actor-free final composite; canonical ridge phase; smooth silence release. |
| B — musical terrain pilot | 4–6 | Three geographically appropriate compositions, measured motion, restrained natural water. |
| C — catalog validation | 7 | Current-source visual evidence, catalog coverage, export and device results. |

Use one focused commit per completed task. A branch may contain several commits, but do not merge a visual pilot on the strength of unit tests alone. The gates below are concrete verification work, not requests for repeated conversational permission.

### Task 1: restore the default composition and test its real draw path

**Modify:** `src/world/LandscapePresentation.js`, `src/render/Renderer.js`, `src/world/BiomeManager.js`, `test/landscapePresentation.test.js`, `tools/range-scene-smoke.mjs`.

**Keep as historical/reference code unless removal is necessary:** `src/world/InhabitedShore.js`, its helper tests. Do not introduce a new resident mode.

**Interfaces:** retain `resolveLandscapePresentation(world)`; its default `inhabitants` becomes false. Extend `landscapeOwnership(page)` with an explicit visible-resident-pass counter/diagnostic and assert it is zero for listening. Simulation ownership and visible drawing are separate assertions.

- [ ] Extend presentation tests to draw an actual alpine manager stub through Renderer with the shore painter instrumented. Assert zero resident/ship/star draws for default, legacy, silence and compatibility URLs; assert the Cathode boss still draws where expected. Do not set `sim.biomes=null`, which bypasses the relevant branch.
- [ ] Run `node --test test/landscapePresentation.test.js`; confirm the new resident-path assertion fails on the baseline.
- [ ] Disable the unconditional shore and resident pass. Restore one coherent owner for flood and transition overlays when the shore is disabled. Keep the useful earlier ocean/glacial rules and preserve unaffected worlds.
- [ ] Assert overlays draw once, above their intended receivers, with correct ground/glacial transforms under both signs of shake and roll. Check visibility in actual final composites in Task 7; a command-order test alone is insufficient.
- [ ] Run `node --test test/landscapePresentation.test.js test/inhabitedShore.test.js test/rangeSkyComposition.test.js`. Expected: zero failures. Capture a matched current-head versus corrected Teton frame before further art changes.
- [ ] Commit as `fix: restore actor-free Range composition`.

**Done:** no default residents, no universal third-height sea, no doubled flood/flash pass; natural terrain remains visible underneath. This task should be reviewable independently of later art tuning.

### Task 2: make Dancing Ridge advection reconstruct from song time

**Modify:** `src/world/RidgeMotionHistory.js`, `src/world/alpine/RidgeMotion.js`, `src/world/alpine/RangeFrame.js`, `src/world/BiomeManager.js`, `test/ridgeMotionHistory.test.js`, `test/landscapeMotion.test.js`.

**Interface decision:** add exported `ridgeAdvectionPxAt(heardTimeMs, reducedMotion=false): number` in `RidgeMotionHistory.js`. Initial trajectory is `220 * max(0, heardTimeMs) / 1000` logical units; reduced motion returns zero. This preserves the existing nominal 220-unit/s basis. Existing source-specific tuning remains the single multiplier for musical scrolling. Rename the ridge sampler input from `worldX` to `advectionPx` and update all production/test callers; leave Simulation's `worldX` untouched for unrelated ground and gameplay paths.

- [ ] Replace the fixed-pose seek regression with actual `sim.lerpState(1)` samples. Use a 12 s, 50 Hz source, RMS `.01`, bands `[.9,.05,.05,.05,.05,.05,.05]`, seed 45; step one sim in 10 ms increments to 4000 ms and call `startAt(4000)` on another. Assert deep equality of both ridge point arrays and neutral arrays. Baseline fails with approximately 261.961 logical-pixel maximum difference.

  Core assertions inside that regression, using actual simulations:

  ```js
  const frames = [played, seeked].map(sim => buildRangeFrame({
    frameId: 1, sim, pose: sim.lerpState(1),
  }));
  assert.equal(frames[0].timeMs, frames[1].timeMs);
  assert.deepEqual(frames[0].ridges.dance.points, frames[1].ridges.dance.points);
  assert.deepEqual(frames[0].ridges.dance.neutralPoints, frames[1].ridges.dance.neutralPoints);
  ```
- [ ] Add an integration case with a real source crest, plus backward/forward seek, off-grid heard time, pause, restart, recorded provisional/final adoption, and export. Compare matching history identities; do not compare sessions with different analysis handoffs as if their inputs were equal.
- [ ] Implement the phase helper and use it in both BiomeManager's live ridge preparation and RangeFrame's standalone fallback. Remove all remaining uses of simulation world travel for musical band advection. Preserve fixed-source moon metrics.
- [ ] Verify function invariants directly: at 0 ms → 0; at 4000 ms → 880; reduced motion → 0; non-finite input → finite neutral result. At matching heard time, changing simulation world travel must not change the ridge.
- [ ] Run `node --test test/ridgeMotionHistory.test.js test/landscapeMotion.test.js test/ridgeComposition.test.js`. Expected: zero failures. Inspect one moving comparison to ensure nominal direction and existing 2×/3× tuning were preserved.
- [ ] Commit as `fix: reconstruct ridge advection from heard time`.

**Done:** ridge shape no longer jumps because a seek or analysis adoption resets spatial origin. Public playback/seek/export verification remains required in Task 7.

### Task 3: give physical terrain a deterministic silence release

**Modify:** `src/world/RidgeMotionHistory.js`, `src/world/alpine/RangeFrame.js`, `test/ridgeMotionHistory.test.js`, `test/rangeFrame.test.js`, `test/rangeExpression.test.js`.

**Interfaces:** add `motionPresence01` to each immutable history sample and blend it in `createRidgeMusicSampler()`. Add optional `motionPresence01` and `calibrationActivity01` inputs to `rangeMusicState()` and carry them in its returned object. Presence controls physical geometry only; retain raw `activity01` for evidence/noise gating. Feed `calibrationActivity01` from existing causal `pressureEnergy01`, and use it for `calibrateRangeMusic()`'s projected target. Otherwise a raw silence edge could still change calibration gain abruptly after the binary motion gate is fixed. Non-history consumers retain their existing fallback behavior.

**Algorithm decision:** reconstruct a causal envelope from existing physical-audibility/MIDI-tail evidence on the existing checkpoint clock. Use 80 ms attack and 450 ms release time constants, with `v += (1-exp(-dt/tau))*(target-v)`. `target` is 1 only when the existing audible gate is true. Initial state is zero; snap values below `1e-5` to zero. No future source sample and no render-frame state. Reduced motion overrides all geometry to zero.

- [ ] Add a 12-second fixture with one second of bands `.8`/RMS `.01`, then silence. At 999.9 versus 1000 ms assert geometry presence differs by less than `.001` and sampled deformation by less than `.1 m`; baseline fails. Test both uncalibrated geometry and an actual per-view calibration where the geological cap is not the limiting gain. After 6 seconds of silence require presence and all displacement channels to be zero.
- [ ] Add initially silent, sub-floor noise, quiet sustained, actual MIDI release, and a second onset during decay. Assert silence/noise cannot start geometry, quiet music remains responsive, and repeated/cold-seek samples match sequential samples.
- [ ] Implement the envelope in the existing history state/checkpoints; use it in place of the binary physical motion gate. Keep kick/melodic envelopes independently bounded and do not loosen pitch provenance.
- [ ] Extend the recorded handoff test to the new field, including a seek inside its 500 ms blend. Preserve current generation ownership.
- [ ] Run `node --test test/ridgeMotionHistory.test.js test/rangeFrame.test.js test/rangeExpression.test.js`. Expected: zero failures. Record an onset→silence clip with camera locked for inspection.
- [ ] Commit as `fix: release terrain pressure smoothly into silence`.

### Task 4: make foreground and framing serve each view

**Create:** `src/world/alpine/RangeComposition.js`, `test/rangeComposition.test.js`.

**Modify:** `data/terrain/scenic-views.json`, `tools/build-range-scene.mjs`, `src/world/terrain/SceneCatalog.js`, generated `src/world/terrain/sceneCatalogData.js`, `src/world/alpine/RangeFrame.js`, `src/world/alpine/RangeScene.js`, `src/world/alpine/RockStage.js`, `src/world/BiomeManager.js`, `src/render/Renderer.js`, `test/sceneApproval.test.mjs`, `test/rangeSceneFraming.test.js`, relevant export tests.

**Interfaces:** an optional authoring object `composition: { foreground: 'ledge'|'none', nearLedgeMaxFrac: number }`. Values must be finite and within `[0,.12]`; explicitly author `'ledge', .12` for the first two pilots and `'none', 0` for the candidate after coverage is established. Add pure `resolveRangeComposition(view): null | {foreground, nearLedgeMaxFrac}`; null preserves existing near-stage behavior in views not yet migrated. Carry resolved composition per view/side, not one outgoing setting across A/B travel. Include canonical `compositionSha256` in changed-view approval identity. Old metadata-free records remain valid until their composition changes; do not hand-edit the generated catalog.

- [ ] Add tests for invalid metadata, deterministic resolution, per-side travel settings, empty lower-frame coverage, and approval invalidation. Add a final-compositor fixture that fails when an opaque band truncates terrain despite the scenic-only exposure test passing.
- [ ] Implement a shallow broken ledge for Teton and dry Monument Valley; use no artificial stage for the forced Pend Oreille view if its scenic surface covers the full lower frame. Limit coverage to `.12H`, remove repeated full-width slab bands, and keep the support/pool math coherent where a ledge remains. If an uncovered region exists, adjust the authored rail/near terrain; never fill the gap with invented ocean.
- [ ] When a view does not need a ground stage, skip its build/render and release ground-target ownership only when neither travel side needs it. Add lifecycle assertions for ledge→none, none→ledge, context loss and resize.
- [ ] Author existing camera/FOV values to retain foreground scale cues and valley depth across 21 rail stations. Keep heard-time travel, world-up, source bounds, and the existing far-crest exposure minimum `.55` and crest-width minimum `.50`. Do not add per-kick camera acceleration.
- [ ] Use uniform fitting for non-16:9 exports. Test a nominal circle has equal fitted x/y radius, verify content bounds/letterboxes, and test a portrait phone viewport separately from portrait output. Preserve standard landscape export dimensions.
- [ ] Run `node --test test/rangeComposition.test.js test/sceneApproval.test.mjs test/rangeSceneFraming.test.js test/rangeSceneTransition.test.js test/rangeSceneLifecycle.test.js`. Expected: zero failures after new evidence is recorded and authoring approvals regenerated through the existing tool.
- [ ] Capture the three pilots and Ross regression at start/mid/end rail positions plus 20/50/80% travel seams. Commit as `feat: frame Range terrain with restrained near ground`.

**Done:** the full composition preserves scale without a universal stage/sea mask. If an altered camera needs unavailable source assets to rebuild, keep that camera unchanged and record the limitation; do not fabricate new hashes or approvals.

### Task 5: calibrate motion where the viewer can see it

**Modify:** `src/world/alpine/RangeFrame.js`, existing relevant `RidgeMotion.js` tuning only if measured evidence requires it, `tools/landscape-performance-smoke.mjs`, `test/rangeFrame.test.js`, `test/rangeExpression.test.js`.

**Create:** `tools/lib/range-motion-metrics.mjs`, `test/rangeMotionMetrics.test.js`.

**Interface:** `measureProjectedMotion({neutralPoints, activePoints, visibleMask, nominalHeight}): {visibleCount, medianPx, p95Px, maxPx}`. Inputs are matched projected source anchors; exclude hidden/water-pinned anchors. Normalize reported displacement to 720 nominal pixels. Record crest, mid-flank and near-feature groups separately.

- [ ] Unit-test normalization, masked anchors, empty groups, zero motion, and fixed-camera comparisons. Add a test demonstrating that an `8–20px` target uniform alone cannot pass the measurement.
- [ ] Capture neutral and active geometry at identical camera/time/lighting for quiet, sustained-bass, isolated-kick and dense passages in all three pilots. Log actual calibration gain, geological cap, projected bound, and measured distribution. Separately capture normal moving-camera clips.
- [ ] Tune existing per-view calibration/framing, never an extra global amplitude multiplier. Initial artistic target: strong sustained passages show roughly **4–10 px** movement in an identifiable visible flank at 720p while quiet passages remain calmer. This is a pilot target, not a universal crest requirement. A view that cannot achieve it within the geological cap must use closer framing or be recorded as unsuitable for that role; do not exceed the cap.
- [ ] Preserve water displacement exactly zero, attached forest bases and shared normals/depth. Ensure dense music does not cause camera wobble or synchronous whole-world kicks. Do not weaken reduced-motion or reduced-flash semantics to achieve movement.
- [ ] Run `node --test test/rangeMotionMetrics.test.js test/rangeFrame.test.js test/rangeExpression.test.js test/terrainModComposition.test.js`. Expected: zero failures. Inspect a 20–40 second clip and the same source with music response disabled to distinguish musical causality from ambient travel.
- [ ] Commit as `feat: calibrate visible terrain motion by view`.

**Done:** evidence identifies which terrain features perform each source, how much they visibly move, and which views remain limited. Do not describe all terrain as dramatically animated because a single reference view passes.

### Task 6: tune natural water without adding a reflection subsystem

**Modify:** `src/world/alpine/TerrainMaterial.js`, `src/world/alpine/RangeScene.js`, applicable existing material rules in `data/terrain/scenic-views.json`, `tools/landscape-lighting-smoke.mjs`.

**Create:** `test/rangeWaterResponse.test.js`.

**Interfaces:** optional bounded material rule values `waterSkyMix` (default `.9`, valid `0..1`) and `waterGlintGain` (default `3`, valid `0..3`), passed as receiver uniforms. Initial Teton audition values `.65` and `1.5`. Preserve existing values for other views until reviewed. Changes participate in existing material-rule hashes.

- [ ] Test finite bounds, unchanged dry material output, source water masks, hydro pinning, and zero direct glint when the shared celestial direct key is zero. Add a regression asserting terrain and water use the same final celestial position/color.
- [ ] Make the two existing hard-coded shader gains tunable through material rules. Compare Teton/Ross day, moon, dusk and celestial gaps at identical camera/music. Lower broad lake glare while retaining a recognizable celestial glitter path and readable depth. Avoid a global terrain darkening workaround.
- [ ] Keep ripple scale tied to source coordinates and existing heard time. If this iteration still needs terrain reflections to meet art goals, record that as a separate future investigation; do not add render targets here.
- [ ] Run `node --test test/rangeWaterResponse.test.js test/rangeShaderSource.test.js test/rangeMaterialManifest.test.js test/sceneApproval.test.mjs`. Expected: zero failures after deliberate metadata/evidence updates.
- [ ] Capture matched receiver crops and whole frames, review both, and commit as `style: balance natural water against terrain mass`.

### Task 7: validate the final renderer and extend to the existing catalog

**Modify:** `tools/landscape-performance-smoke.mjs`, `tools/range-scene-smoke.mjs`, `docs/range-v2-device-runs.md`, `docs/range-v2-progress.md`.

**Create:** `docs/evidence/terrain-continuation/README.md`, source/fixture manifest, matched stills, moving clips, metrics and device reports. Retain earlier evidence with its original source identity.

- [ ] Freeze the candidate source. Record commit, dirty production hashes if any, actual served hashes, input file SHA256, construction/song seeds, heard time, immutable history identity, view IDs, backing/viewport/DPR, quality, renderer identity, and actual active v2/fallback state.
- [ ] Use the original historical fixture archive if available. Otherwise generate new reproducible fixtures with the existing generator and retain the recipe and bytes; never label regenerated input as the old fixture. Use a separate baseline checkout for matched comparison.
- [ ] Review Teton, Monument Valley and forced Pend Oreille first, Ross as regression, then all 13 approved views at 21 rail stations. Preserve existing exposure tests but add final-compositor checks for ridge visibility, terrain truncation, water placement and near coverage. Candidate coverage does not constitute approval.
- [ ] Run real transport sequences: normal playback→pause→seek backward/forward→restart→analysis adoption→export, with asymmetric bands and actual poses. Compare geometry/state only for equal input histories and use image crops to catch late compositor changes. Capture real context loss/recovery and quality 0/3/6.
- [ ] Run `npm ci`, `npm test`, `npm run lint`, then `npm run stage:site` in the isolated implementation checkout. Require an actual dependency-based runtime rebuild check, not just `rebuilt:false` hash verification. Start the staged server and run bootstrap, seek and export smoke; decode the recorded video/audio and inspect frames.
- [ ] Use real recordings the user can lawfully provide: short pop, dense metal, long progressive, quiet ambient, and an abrupt intro/silence case. Synthetic rhythm fixtures establish mechanics; they do not establish musical quality or natural chapter selection. Keep the already-shipped earned chapter policy.
- [ ] Record normal live playback on desktop and at least one physical Android device for 10 minutes, with cold start, steady playback, two-view travel, thermal settling and song replacement. No screenshot/readback loop during timing. Report the exact backing/quality regime rather than hiding a downgrade in an average.
- [ ] Apply existing device gates: desktop steady p95 ≤20 ms; Android ≤34 ms; travel ≤1.5× steady; no more than one >100 ms stall per minute outside cold; zero ledger overcommit; ≤256/128 MiB ownership; no whole-section fallback or repeated quality chatter. If unavailable, mark hardware acceptance pending and keep broader rollout unclaimed.
- [ ] Obtain a fresh whole-branch review focused on actual draw paths, timing reconstruction, metadata approval identity and memory cleanup. Address evidenced findings, update the checkpoint, and commit as `test: validate coherent Range terrain presentation`.

**Done:** evidence supports the exact final source, names remaining limits, and demonstrates both visual/musical value and stable delivery. A new PR should lead with the corrected behavior and include the matched clips, transport regressions, and device results. Do not merge or deploy as part of a plan-only request.

## Completion checklist

- [ ] New visible draw paths are covered, not only old actor ownership.
- [ ] Ridge points agree with actual poses at equal heard time.
- [ ] Silence releases causally and initially silent sources stay neutral.
- [ ] Lakes, dry land and inland glacial terrain retain their identity.
- [ ] Both musical ridges stay readable; near ground serves depth.
- [ ] Terrain motion is measured in visible output and respects physical caps.
- [ ] Portrait fitting preserves proportions; phone viewport and export are separately tested.
- [ ] Changed authoring inputs have new legitimate evidence/hashes.
- [ ] Export includes matching terrain/lighting and decoded audio.
- [ ] Current-source desktop/Android status is explicit; historical results are not reused as new passes.

**Recommended first implementation:** Delivery A, followed by the three-view pilot. The crucial artistic question is whether the same song now feels embodied by the landscape. More places and more effects can wait until that answer is visible in motion.
