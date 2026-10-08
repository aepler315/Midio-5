# Visual evaluation loop implementation plan

> Execute inline with the executing-plans workflow. The user requested implementation; no intermediate approval gates.

**Goal:** Reproducible real-render evidence and a practical coding-model iteration loop.
**Architecture:** Manifest-driven Chromium captures through the existing export clock, an owned immutable loopback server, offline reports, and strict before/after compatibility.
**Tech stack:** Node, existing Playwright, browser canvas, node:test.
**Spec:** docs/superpowers/specs/2026-10-08-visual-evaluation-loop-design.md

## Global constraints
- Production visual behavior remains unchanged.
- Pin audio, seed, view, quality, viewport, browser and timing for comparisons.
- Fail on incorrect rendering and preserve partial evidence; no beauty scores.
- Generated fixture audio is redistributable; real recordings stay local and ignored.

## Review focus
- Empty schedules and clips beyond the song cannot silently pass.
- A pre-existing output folder cannot overwrite baseline evidence.
- Files changing during a run cannot misidentify the captured source.
- Missing captures, changed audio or changed browser cannot form a valid A/B comparison.
- Report text and filenames must not inject markup or traverse paths.

### Task 1: Capture contract and comparison semantics
**Files:** tools/lib/visual-evaluation.mjs, test/visualEvaluation.test.mjs, test/fixtures/visual-evaluation.json.
**Interfaces:** normalizeManifest(value), captureSchedule(song, durationMs, settings), compareReports(before, after), imageDifference(a,b).
- [x] Write failing behavioral tests for invalid/duplicate cases, bounded sorted schedules, missing captures, changed audio/settings/browser and image difference.
- [x] Run node --test test/visualEvaluation.test.mjs; observe missing implementation.
- [x] Implement the contract and default fixtures; rerun tests.

### Task 2: Owned server, browser capture and review output
**Files:** tools/visual-evaluate.mjs, tools/lib/visual-evaluation-browser.mjs, tools/lib/visual-evaluation-report.mjs, tools/lib/visual-evaluation-server.mjs, test/visualEvaluationServer.test.mjs, package.json.
**Interfaces:** CLI --manifest PATH --out DIR; CLI --compare BEFORE AFTER --out DIR. Task 1 supplies validation, schedule and compatibility.
- [x] Write server tests for an immutable snapshot, traversal rejection and changed source identity; run red.
- [x] Implement server and CLI; fail if output exists, use real file upload, capture export frames and record diagnostics.
- [x] Generate offline contact sheets, audio-backed clips and A/B reports with exact timestamps and no automatic quality verdict.
- [x] Run focused tests and a real capture; inspect images and rerun identical input; verify invalid comparison fails.

### Task 3: Repeatable workflow and verification
**Files:** docs/visual-evaluation-loop.md, AGENTS.md, .github/workflows/visual-evaluation.yml.
- [x] Document commands, review rubric, failure handling, continuous versus sparse capture and real-song manifests.
- [x] Add CI capture and artifact retention using existing setup; do not add deployment.
- [x] Run npm test, lint, actual CLI capture and comparison; report any baseline failures.
- [x] Review the complete branch, fix material findings and commit.

## Verification record

- Final implementation suite: 3,745 passed, five skipped, zero failed; lint clean.
- Independent review found paired missing provenance accepted by comparison. Fixed with a red-to-green regression and complete required-field validation.
- Local Chromium 153.0.8010.0: two real 12-second contrast runs, eight saved frames each; 8/8 PNGs byte-identical. Range v2, view, seed, quality and timestamps verified.
- Offline report audio playback advanced through the selected frames and stopped at the clip end, without page errors.
- CLI rejected an incompatible seed; existing output protection and failed-browser report preservation exercised.
- GitHub CI run 37762727418 completed both three-fixture captures and artifact retention; all 31/31 repeated PNGs were byte-identical. The later required-metadata fix was validated locally against real browser reports.
- Ruling: obtain a packaged Chromium for local verification when the normal browser CDN is unavailable. No project dependency or renderer behavior was changed.
- Sparse export evidence does not certify uninterrupted playback or hardware FPS; these limits are in the guide.
