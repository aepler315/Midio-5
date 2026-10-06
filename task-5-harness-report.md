# Task 5 browser harness handoff

Owned change: `tools/version-browser-smoke.mjs` only.

Run after one full archive has been staged:

```sh
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/version-browser-smoke.mjs --site _site --output .smoke/version-browser
```

The harness serves the staged directory through its own bounded static server. It runs `/` then `/Midio-5/`, with one Chromium/context per prefix and no concurrent suite. It generates deterministic WAVs through `tools/gen-test-wav.mjs`, imports them through the application's normal file input, and selects the actual Alpine/Range world. It never substitutes demo playback or a fake ready adapter.

Artifact audit checks exact catalog/source SHA order, complete byte budget including the build report, every emitted file's hash/byte count, chained transformation hashes, undocumented edits, runtime audit declaration, and renderer files independently against pinned Git objects. Browser responses are hashed against those emitted files. Failed local runtime requests and unexpected page/console/shader errors fail the run.

Playback evidence covers all eight checkpoints in both directions, actual RangeScene versus JourneyScene identity, active Range renderer, nonblank composed pixels, stage/audio-context ownership, version-local workers, endpoint disabling and visibly different live/circular/curved frames. The adapter's production `loadSource` is observed at settlement and `setPaused` immediately before resume, so the 100ms tolerance is measured before the clock advances. Initial AudioBufferSource start offsets catch beginning-of-song playback bursts. Ordered File metadata/content hashes and seed/source/pause identity are compared across switches.

Other checks cover running and paused handoffs, current source replacement, ordered stems in real IndexedDB, reload, browser Back/Forward, portrait/reduced-motion geometry, focused HUD lifecycle, hidden keyboard inertness, first-tap wake, real calibration/recording blockers, an actual saved canvas recording, missing destination plus retry, source-payload quota injection, interrupted restore plus retry, rapid activation, independent loaded tabs, copied-sessionStorage duplication, a matching pending IDB record with the original owner alive, direct archive return, IndexedDB-open denial, and missing-manifest file-picker availability.

Each prefix emits screenshots for every traversed stop, a portrait screenshot, actual saved recording, Playwright trace, detailed JSON report and a sampled CDP click-through MP4 encoded with system ffmpeg. CDP recording avoids the optional Playwright ffmpeg download. The MP4 is sampled every two seconds and played at 2fps (approximately four times speed); it is derived from actual browser screencast frames. Reports include limitations. Failures exit nonzero and preserve partial reports/traces/screenshots; success is never inferred from arrows alone.

Validation performed by this worker: `node --check tools/version-browser-smoke.mjs` and `npx eslint tools/version-browser-smoke.mjs`, both pass. Per controller instruction, the complete artifact/suite was not staged or run here. Integration needs to run the new harness against the final artifact and resolve concrete failures.

Remaining limitations: Chromium only; physical iOS/audio policy and safe areas, acoustic output, process-wide audio exclusivity, full-song export blocker, deployment duration/configuration, and independent visual review require separate release evidence. Pending duplication uses an injected matching IDB record while the real owner remains active; it does not measure every browser duplication race. Existing recording excludes DOM chrome by capturing only `#stage`, and a real recording is saved; full-song export is not claimed tested.
