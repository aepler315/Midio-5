# Historical Range revelation pilot validation

> Superseded by the landscape performance implementation. The current default
> has no opening cast or delayed scenic handoff, and uses provisional analysis
> during playback. Old revelation/gameplay URLs select the same landscape.
> See [current validation and evidence](../../evidence/landscape-performance/README.md).
> Results below describe the earlier pilot and are retained as historical evidence.

Enable **Shared world → landscape (pilot)** in the title settings, or use
`?rangeExperience=revelation`. Trio and gameplay remains the default. The
pilot is limited to Range/alpine worlds. Seek and Restart are available in
the listening HUD's expandable Seek control.

The pilot waits for full-song analysis. Its immutable schedule belongs to
the song and survives Simulation reconstruction, seek, replay and export.
This costs an additional loading wait on long uncached recordings compared
with gameplay's provisional opening analysis.

## Verification on 2026-09-30

- `npm test`: **3,545 passed, zero failures**.
- `npm run lint`, `git diff --check`, and
  `node tools/build-range-runtime.mjs --check`: passed.
- `npm run stage:site`: passed.
- Bootstrap browser smoke: app loaded and Browse files opened its chooser.
- Chromium/SwiftShader revelation smoke: **10 frames passed on each of two
  profiles**, desktop 1280×720 and emulated mobile 390×844 / 4 GB.
- Both profiles drew v2 at opening, handoff and final. The final frame had
  zero cast/emitter presence, including reflection capture and satellite
  paths. Repeated draw and rebuilt export reproduced identical narrative
  snapshots. Context loss retained final narrative state in legacy, then
  recovered v2. Reduced motion/flash and disabled heavy film effects retained
  essential narrative rendering.
- Cast-off and quarter-presence comparisons used matched musical time,
  seed, geography and quality. These are comparison material, not a verdict
  about which presentation feels better.
- Highest captured owned residency: desktop **153,749,067 B** within its
  268,435,456 B budget; emulated mobile **125,103,827 B** within its
  134,217,728 B budget. These are ledger estimates, not measured driver VRAM.
- Additional feature geometry reserves at most **55,296 B per view**. It
  shares terrain displacement, glacier chronology and prepared depth; it
  adds no full-resolution narrative crossfade target.

## Reproduce browser checks

```sh
node tools/gen-test-wav.mjs /tmp/revelation.wav 120 120
node tools/serve.js 8092
# In another terminal; set PLAYWRIGHT_CHROMIUM_PATH if needed:
node tools/range-revelation-smoke.mjs --url http://127.0.0.1:8092 \
  --wav /tmp/revelation.wav --output .smoke/revelation
node tools/range-revelation-smoke.mjs --url http://127.0.0.1:8092 \
  --wav /tmp/revelation.wav --output .smoke/revelation-mobile \
  --width 390 --height 844 --profile mobile
```

Each run writes PNGs and a JSON report with actual renderer state, narrative
channels, source provenance, residency and runtime errors. Software GL draw
times must not be interpreted as desktop or Android frame-rate evidence.

## Fresh code review and fixes

One independent whole-branch review found three important defects, all
reproduced as failing tests before correction:

1. Provisional opening analysis could finish departure early, then full
   analysis could restore performers. Listening now loads full analysis and
   preserves the song's schedule across rebuilds.
2. Very low physical recording noise could advance the arc before music.
   The calibrated RMS gate now sits above measured noise below approximately
   −90 dBFS. Separate quiet physical-music and normalized-activity fixtures
   retain quiet passage progression. This gate is a conservative estimate,
   not a general noise classifier.
3. Boundary nudges advanced cast/material channels through silence. They now
   warp accumulated revelation instead of elapsed time; every channel and
   cast weight shares the gate's silent plateaus.

Additional regressions cover the bundled LineSegments export, complete
reflection-capture departure, satellite departure, partial final analysis
bins, ordered boundary anchors, long MIDI notes, synthetic pitch rejection,
source sharing, pressure caps and alpha assignments in legacy painters.

## Rulings and remaining evaluation

- Implemented the supplied design inline without another approval gate,
  because implementation and PR creation were explicitly requested. A scope
  mismatch would require revising this PR.
- Used an isolated fresh clone and feature branch instead of a linked
  worktree; no existing checkout needed protection. The branch remains for
  PR iteration.
- Retained the opt-in pilot status: actual desktop/Android hardware timing,
  travel residency and driver recovery still require device validation.
  Software GL cannot certify hardware smoothness.
- Listener evaluation of companionship, distinct source inheritance and
  loss, and the complete real-recording genre matrix remain pending. Unit
  fixtures and technical captures do not establish the artistic outcome.
  Keeping the pilot optional limits the cost of those unresolved judgments.

No minor code-review findings were deferred.
