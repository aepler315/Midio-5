# Task 1 report: actor-free default landscape

Status: DONE. Branch: `codex/landscape-performance`. Baseline: `99cee063cd1b25667d5bf0def66da291104bd4ae`. No attachment was edited. No subagents were dispatched.

## Implementation and ownership audit

- Added `resolveLandscapePresentation({worldId, stageWidth, stageHeight, groundY})`: explicit landscape/cast=false/incidentalActors=false policy and frozen generic `stageAnchor`. Preserved the old default stage origin (220 at 1280px) and ground (625 at 720px), scaled for logical dimensions.
- Removed actual Midio, Broshi, Midasus, performer, ensemble, excursions, gaze/focus, jump/autoplay/judging/score/fever, obstacle/telegraph, gnat, combat, opening assembly and landing effects ownership from shared Simulation. No actor construction or updates remain there. Removed their wildcard/anticipation subscriptions, accent air jumps, reentry impulses, camera fitting and landing camera shakes.
- Retained source/heard clocks, source-aligned SongBeatTransport, tap BeatAnchor/GrooveFingerprint/calibration/SyncMonitor, heard-time ground glow, world travel, weather, key/hype/calm, world cues, natural disaster/flood/orogeny, world film/finale timing, chapter state, biome selection and graphics policy. The world retains its original travel speed.
- Added independent `compileRangeSources` with the existing causal lane/role and pitch-provenance confidence lookup. `Simulation.sampleWorldSources(timeMs)` returns frozen source records. Useful lane IDs remain compatible. The old reveal schedule compiler stays available as a standalone legacy module, but listening construction no longer compiles the discarded whole-song arc.
- RangeFrame always carries `narrative:null` and `emitters:[]`, even if stale actor objects/reveal callbacks are supplied. Lead pitch activity is unweighted by reveal handoff; distinct analyzed bass-lane evidence augments world pressure through max blending, not duplicate fallback voices. Clean-lane activity reaches SpaceRidge without a performer or reveal handoff; its incidental satellite is absent. Artistic ridge/lighting/shaft tuning remains for subsequent tasks.
- Removed the live Renderer body, voyage/burrow, brush/trail, personal glow/light, contact shadow, actor mirror/capture and battle/gnat draw paths. Retired `_capture` owners are disposed and nulled before reuse; no PerformerCapture import or allocation exists on the shared render path. Standalone PerformerCapture/WetReflection utilities and their disposal/ledger tests remain intact. Generic deprecated pose aliases preserve old world-painter signatures without an actor.
- BiomeManager no longer constructs FarVignettes, SkyEnsemble or Murmuration. Ship/sea-life/monster schedules are empty, massif marker spawning and draw callbacks are disconnected, and retained compatibility entry points cannot draw/spawn actors. Removed narrative sky/material/geometry suppression. Scenic sun/moon, clouds, sky/water reflections, islands, terrain, roots, stones, forest, glaciers, natural hazards and baked terrain dressing remain.
- NearField filters artificial street posts/road markers/pipes/piers and Cathode near props while retaining alpine/airless stones, overgrowth roots/trunks and abyssal rooted sea fans. Baked world architecture/material identity is preserved.
- Removed the obsolete pilot selector and character track badges. Old `rangeExperience=revelation` URLs use the same default and accessible seek/restart controls. Removed extra revelation analysis waits from main and OpeningAnalysis; provisional-to-final analysis retains its existing lifecycle. End-of-run stats now report duration, tempo, sections and stage dimensions. Debug overlay no longer dereferences Broshi.
- Audited Cathode separately: its own renderer uses source/world transport and retains its defining boss. No boss redesign/deletion was made. WebGL wrapper delegates to the same actor-free shared Renderer; Range v2 consumes the actor-free RangeFrame.

## TDD evidence

Applied `superpowers:test-driven-development` and its writing-good-tests reference. Native Canvas/Path2D/OffscreenCanvas are recorded in test utilities; Simulation, Conductor, Renderer and BiomeManager behavior remains real. GPU/strip prewarming is skipped only at the native canvas boundary in state-only Node tests.

1. RED: `node --test test/landscapePresentation.test.js test/performerCapture.test.js test/wetReflection.test.js test/audibleTransport.test.js` => 27 tests, 20 pass, 7 fail. Intended failures: actual Midio ownership at time zero (opening/silent/old option/other world), actual fallback actor emitters, FarVignettes construction, and failure to dispose retired capture ownership. Earlier test-fixture setup errors (missing perf/canvas prewarm boundary) were corrected and rerun before implementation; the recorded RED run was assertion failures for the missing behavior.
2. GREEN: after ownership removal, 7 new absence cases passed. Existing sparse-tempo test migrated from retired JumpController timing to actual Conductor dispatch and retained its detected phase assertions.
3. RED: `node --test test/landscapePresentation.test.js` => 7 pass, 1 fail: distinct bass evidence had been lost from mountain pressure when reveal handoff was removed. GREEN after restoring distinct bass lane max blending: ownership/source tests passed.
4. RED: direct real Renderer opening/seek/restart/final/export/fallback integration with throwing getters found lingering actor focus access in salience and the hype border. Both were removed; after native graphics fixture completion the 10 landscape tests pass. These tests instrument actual owner access, composed draws and capture disposal, not alpha alone.
5. RED: `node --test test/openingAnalysis.test.js` failed because `rangeListening:true` still forced a whole-song analysis wait. GREEN after retiring that obsolete predicate. The actual asynchronous load lifecycle test confirms provisional playback starts and final analysis is adopted.

Final required focused command:

```
node --test test/landscapePresentation.test.js test/performerCapture.test.js test/wetReflection.test.js test/audibleTransport.test.js
30 tests; 30 pass; 0 fail; 0 skipped
```

Final full suite, run after all production changes and before commit:

```
npm test
3555 tests; 3 suites; 3555 pass; 0 fail; 0 cancelled; 0 skipped; 0 todo
Duration: 32897.737926 ms
```

`npm run lint` passes. Removed only the obsolete Renderer/Simulation unused-variable ESLint suppressions. `git diff --check` passes. npm prints the existing environment warning about `http-proxy`; no ESLint warnings/errors remain.

## Browser smoke evidence

Browser: `PLAYWRIGHT_CHROMIUM_PATH=/tmp/midio-headless/chrome-headless-shell-linux64/chrome-headless-shell`. Server and harness spawned in the same exec networking namespace.

- `PLAYWRIGHT_CHROMIUM_PATH=... node tools/bootstrap-smoke.mjs`: passes (initial and final rerun). App loads and Browse files opens the chooser.
- Node orchestration spawning `tools/serve.js 4192` and `runAudioSmoke({url:'http://127.0.0.1:4192/?rangeExperience=revelation', outDir:'/tmp/task1-controls'})`: all 23 checks pass. Includes real upload/analysis/world choice, audio+sim advancement, visible changing scene, pause/resume, replacement teardown, stop, reachable controls and zero browser errors.
- Node orchestration spawning `tools/serve.js 4193` and `tools/export-smoke.mjs http://127.0.0.1:4193/?rangeExperience=revelation /tmp/task1-export`: all 17 checks pass. 720p MP4 saved (617667 bytes), decoded at 1280x720 with 39289 colors and sound (80333 decoded audio bytes), duration 5.4s. Full-song car export decoded at 800x480, correct letterboxing, sound (77935 decoded audio bytes), duration 20.4s, zero browser errors.
- Software/headless browser smoke establishes functionality, not hardware FPS or matched-video artistic approval. Matched ridge/lighting visual evidence belongs to later tasks.

## Full-suite discovery and repaired expectations

First full discovery after implementation: 3552 tests, 3535 pass, 17 fail. All failures were inspected; none omitted. Superseded performer/reveal contracts were migrated to their new observable outcomes, while useful transport/world/capture utility coverage was retained.

Initial failures:
- the Range narrative pilot waits for full-song evidence before offering playback
- no this.method() call passes more arguments than the method declares
- each live cue kind reaches its own engine entry point
- a flourish cue defers the disc until after ensemble.update, like a drop
- a drop cue both surges the hype and arms the deferred disc flourish
- a ground-pulse cue both shocks the terrain and echoes it on screen
- every cue in one step is applied, not just the first
- ambient heat grows toward the ground in backing-store coordinates (720px)
- ambient heat grows toward the ground in backing-store coordinates (1440px)
- the crest respects the opening fade without vanishing at the lowest scene budget
- world foreground geometry is independent of a generated landmark key
- world props stay within bounded coverage and stop swaying under reduced motion
- no perf policy means full quality for a world that paints the effect
- legacy reveal input cannot restore emitters or delay the landscape opening
- drawCharacterReflections skips inactive entries (burrowed/voyaging) and non-finite positions
- drawCharacterReflections offsets each reflection by that character's own ripple sample
- lerpState: midioX stays the pure origin, midioDrawX carries the interpolated skid

Second full retry: 3554 tests, 3552 pass, 2 fail. `v2 draws its partitions at the retained pass boundaries, legacy scenery not at all` still expected the deleted FarVignettes callback; its expected order was corrected. `frame timings sum every pass of a frame and restart with the next frame` failed a wall-clock ratio under concurrent load. That timing test and production timing code were not weakened or modified: it passed unchanged in the isolated 40-test retry and both subsequent full runs (3555/3555).

During self-review, lint caught a leftover laneGlyph call after its removed definition; the call was removed, lint rerun clean, and the final full suite rerun clean. Direct render access tests exposed and removed the two focus references before final verification. Heat origin now reads generic stage coordinates, verified at 720/1440 backing heights.

## Files

Production/config/UI changes:
- `eslint-suppressions.json`
- `index.html`
- `src/audio/OpeningAnalysis.js`
- `src/main.js`
- `src/render/Renderer.js`
- `src/sim/Simulation.js`
- `src/ui/DebugOverlay.js`
- `src/world/LandscapePresentation.js`
- `src/world/BiomeManager.js`
- `src/world/NearField.js`
- `src/world/alpine/RangeFrame.js`
- `src/world/alpine/RangeNarrative.js`

Tests: new `test/landscapePresentation.test.js`; updated audibleTransport, audioLoadLifecycle, cueWiring, heatDistortionComposite, horizonPaint, nearField, openingAnalysis, optionalEffects, rangeFrame, rangePresentation, rendererDrawables and traction tests. Retained all standalone legacy actor module and graphics utility tests that still test supported module behavior.

## Self-review and concerns

Reviewed construction, conductor registrations/teardown, Simulation step/startAt, world stage aliases, real Renderer draw/fallback/export, personal light emitters, capture creation/disposal, BiomeManager optional updates and draw-time marker spawning, near-field filtering, provisional/final analysis, selectors/badges/navigation and Cathode boss boundary.

No blocking concerns. Historical actor/pure narrative modules and unused private body painter helpers remain in the repository for compatibility/standalone tests, but no listening path constructs, updates or draws them. The transient timing-test failure is recorded above. This task does not claim artistic acceptance, hardware performance, ridge speed changes, moon coupling, lighting coherence or solar shafts; those remain subsequent tasks.
