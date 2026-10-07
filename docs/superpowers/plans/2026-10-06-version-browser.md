# Midio Version Browser Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking. Intended implementer: GPT-6.1 Sol. This is a plan-only deliverable; do not add self-invented approval gates between execution tasks.

**Goal:** Add large top-left/back and top-right/forward arrows that hide with the HUD and browse real historical Midio builds while carrying the loaded song between them.

**Architecture:** Stage eight explicit visual checkpoints as same-origin, independent static builds, with the live checkpoint at the site root. Inject a shared navigation UI and a narrow session adapter into archived copies; use full-page navigation and temporary IndexedDB handoffs. Never switch GitHub branches or replace production code in response to a visitor's arrows.

**Tech stack:** Existing JavaScript ES modules, Node build tools, Git, IndexedDB, CSS, GitHub Pages, Node tests and Playwright. No UI framework, service worker, iframe host, or new runtime dependency.

**Spec:** [2026-10-06-version-browser.md](../specs/2026-10-06-version-browser.md). Read the spec first; its checkpoint SHAs, UI behavior and failure handling are requirements.

## Global constraints

- Plan-only baseline is main `a47b5b32e63da4fbfa5e2c003dcef26ed16cd453`; refresh main and work in an isolated branch before implementation. The deeper rollback was cancelled.
- Exact eight-entry catalog and order are in the spec. Initially the live entry is `natural-valley` (#399); both later rejected worlds remain browsable.
- Buttons: 64 × 64 CSS pixels on desktop, at least 52 × 52 on narrow screens; share the existing 3000 ms HUD timer. No hidden pointer/keyboard activation and no arrow-key shortcut that overrides existing inputs.
- Handoff uses original ordered files, seed, heard position and pause state. No autoplay guarantee, new analysis algorithm, landscape redesign, or silent song substitution.
- Only documented navigation/session/HUD compatibility patches may alter historical files. Pinned source and transformed output hashes must be recorded separately.
- The complete staged site must be at most 838860800 bytes. Archive output is generated, not committed. Audio remains in the visitor's browser.
- Preserve root and project-subpath hosting, the current staging safety guards, existing input ownership, recording, export and accessibility behavior.

## Review focus

1. A failed/replaced song load must not cause navigation to carry the previous song. Exercise generation ownership in Task 3.
2. HUD invisibility must remove keyboard activation too; focus and mobile wrapping must remain usable. Exercise in Tasks 4 and 5.
3. Historical relative modules/workers/assets and exact patch anchors must resolve at both `/` and `/Midio-5/`. Exercise in Tasks 2 and 5.
4. Quota/storage failure, missing destination, double click and two tabs must not lose playback or consume the wrong handoff. Exercise in Tasks 3–5.
5. An archived build must actually render its historical scene, with one audio stream, and still allow return to live. Verify source identity and rendered frames in Task 5.

## File map

| File | Responsibility |
| --- | --- |
| `tools/version-checkpoints.mjs` | Immutable authored catalog, live mapping and build validation |
| `tools/stage-versions.mjs` | Materialize pinned public trees, adapt them, stage archives and emit manifests |
| `tools/lib/version-adapters.mjs` | SHA-selected, exact-anchor compatibility transforms and transformation ledger |
| `tools/stage-site.mjs` | Keep ordinary staging; opt into full version archive generation |
| `src/ui/VersionCatalog.js` | Validate manifest, resolve allowed same-origin destinations and neighbors |
| `src/ui/VersionHandoff.js` | Temporary per-tab source payloads and versioned navigation transactions |
| `src/ui/VersionNavigation.js` | Buttons, checkpoint label, loading/error UI and navigation state machine |
| `src/ui/version-navigation.css` | Shared navigation layout and accessible hidden/disabled/focus styles |
| `src/main.js`, `index.html`, `src/ui/style.css` | Live session adapter, bootstrap, HUD integration and reserved control space |
| `test/version*.test.js`, `test/version*.test.mjs` | Contract, staging, adaptation, handoff and UI logic tests |
| `tools/version-browser-smoke.mjs` | Real multi-version desktop/portrait and handoff verification |
| `package.json`, `.github/workflows/static.yml`, `.github/workflows/test.yml` | Commands and one complete archive release gate |

## Shared contracts

Define these once and use them in implementation and tests; adapt spelling only if an existing repository convention requires it.

`VersionManifest`: `{ schema: 1, buildSha, liveId, entries: [{ id, label, sourceSha, sourcePr, entryPath, live }] }`. `entryPath` is site-root-relative, not origin-relative; live is `./`, archives are `versions/<id>/`. Catalog entries are unique, ordered oldest-to-newest, with exactly one live entry. A separate generated build report records source/output hashes, transformations and artifact size; do not download it just to draw two buttons.

`VersionSessionAdapter`: `getState()`, `subscribe(listener) -> unsubscribe`, `pause() -> Promise`, `loadSource(source, restoreIntent) -> Promise`, `seek(ms) -> Promise`, `setPaused(boolean) -> Promise`, `wakeHud()`. State reports `{ phase, sourceId, source, positionMs, durationMs, seed, paused, worldId, rangeViewId, settings, blockedReason }`; phase distinguishes title, loading, ready and error. Source is null, `{ kind: 'audio-files', files: File[] }`, or `{ kind: 'demo' }`. `restoreIntent` carries the handoff transport/settings fields and is consumed before first playback. `loadSource` resolves only for the requested successful generation, initialized at the saved position and held paused until final validation; the navigator then calls `setPaused(handoff.paused)`. Do not guess readiness from a non-null old `__SMW` object. Return/reject explicit unsupported-state and load errors.

`VersionHandoff`: `{ schema: 1, tabId, switchId, fromId, toId, sourceId, createdAtMs, positionMs, seed, paused, worldId, rangeViewId, settings }`. File payloads are separate keyed records. Expire unused records at 24 hours. Store the latest successful source only; a pending replacement marks navigation blocked and cannot reuse stale source state.

Navigation states: `idle -> preparing -> leaving`; destination `restoring -> idle|error`. Error offers Retry/Return to live without discarding the source. Use one in-flight switch token, disable both arrows while preparing, and only consume the matching destination handoff after success. Completion retains a latest-session record, distinct from the pending switch, for reload/Back/Forward. Unknown checkpoint IDs never become arbitrary URLs.

## Task 1: Catalog and bounded snapshot feasibility

**Files:** create `tools/version-checkpoints.mjs`, `src/ui/VersionCatalog.js`, `test/versionCatalog.test.js`; inspect historical public trees and deployment workflow.

**Produces:** `CHECKPOINTS`, `LIVE_ID`; `validateVersionManifest(value) -> VersionManifest`; `getVersionNeighbors(manifest, id) -> { previous, next }`; `resolveVersionUrl(manifest, id, siteRoot) -> URL`.

- [ ] Write failing tests for all eight IDs/SHAs/order, one live entry, #399's neighbors (#398/#400), both endpoints, unknown/duplicate IDs, invalid SHA, traversal and off-origin URLs, and `/Midio-5/` roots.
- [ ] Run `node --test test/versionCatalog.test.js`; confirm the intended contract is missing before implementation.
- [ ] Implement the catalog and pure helpers. Read every pinned main/index/HUD layout and assign an explicit compatibility profile. Do not infer compatibility solely from PR numbers.
- [ ] Re-measure tracked public payload size using `git ls-tree -rl` for every checkpoint. Confirm the initial eight full copies fit the 800 MiB budget; the planning measurement is about 711.1 MiB before small navigation additions.
- [ ] Run the tests and commit the catalog. If a milestone cannot run with a narrow adapter, report that concrete incompatibility instead of silently omitting it or relabeling another build.

## Task 2: Archive staging and historical adapter injection

**Files:** create `tools/stage-versions.mjs`, `tools/lib/version-adapters.mjs`, `test/versionStaging.test.mjs`; modify `tools/stage-site.mjs`, `package.json`, relevant workflow checkout/stage steps and `test/stageSite.test.mjs`.

**Consumes:** Task 1 catalog. **Produces:** `stageVersions({ sourceDir, outputDir, checkpoints, liveId }) -> Promise<BuildReport>`; `adaptVersion({ sourceSha, files, siteRootRelative }) -> { files, transformations }`; generated `versions/manifest.json` and per-page trusted navigation metadata. The adapter registration contract is the one in Shared contracts.

- [ ] Write failing tests using temporary Git repositories: exact pinned source extraction, public-file allowlist, missing commit, pinned adapter mismatch, unchanged-file hash identity, root-only CNAME, safe staging paths, invalid output budget and project subpaths. Keep synthetic fixtures small; do not stage 700 MiB in each unit test.
- [ ] Run `node --test test/versionStaging.test.mjs test/stageSite.test.mjs` and observe the missing behavior.
- [ ] Implement trusted `git archive` extraction of allowlisted paths into temporary directories, with checked exit codes and cleanup. Reuse staging safety checks and verify historical runtime/terrain/material hashes. Keep all module/worker/asset paths version-local. Do not substitute current Three.js or terrain manifests into an archive.
- [ ] Implement exact-SHA adapter transforms: add shared navigator/style/site-root metadata and register callbacks inside historical main.js against its real state. Namespace archived `src/audio/AnalysisCache.js` database names by checkpoint, keeping the handoff database separate. Audit other persisted schema compatibility and protect the live library/preferences. Assert each replacement count and expected original hash, and fail the build on drift. The transforms may refer to the Task 3 bridge module; no renderer changes are permitted.
- [ ] Add `stage:versions` as the explicit full archive command. Ordinary `stage:site` remains fast for existing tests. A production release must invoke the full command and cannot silently publish only the live build. Full-archive tests cover manifest availability; ordinary development uses the same UI with a clear unavailable-archive state.
- [ ] Ensure the dedicated archive job has all pinned Git objects (full history or explicit SHA fetches). Current workflows often check out shallowly. Keep network fetching in workflow/setup, not hidden inside the staging function, so offline/unit builds are deterministic.
- [ ] Stage one complete artifact, verify every transformation and total bytes, and run tests. Commit build tooling without committing generated snapshots.

## Task 3: Real source and transport handoff

**Files:** create `src/ui/VersionHandoff.js`, `test/versionHandoff.test.js`; modify `src/main.js` and historical adapter definitions. Keep the API module focused; do not refactor the whole main module.

**Produces:** `createVersionHandoffStore({ indexedDB, sessionStorage, now })` with `saveSource`, `prepareSwitch`, `readPending`, `completeSwitch`, `discardSource`, `pruneExpired`; live/historical implementations of `VersionSessionAdapter`.

- [ ] Write failing tests for ordered stems and metadata, one-source reuse, successful generation ownership, a failed replacement, two tabs including Duplicate Tab/window.open with copied sessionStorage, expired records, transaction/quota failures, wrong destination/token, retry retention and completion cleanup. Use browser IndexedDB in the smoke for the real persistence contract; inject a small storage boundary for pure failure tests without adding a production dependency.
- [ ] Implement successful-source tracking at `loadAudioFiles`, carrying selection generation through `startConfirmedWorld` and actual timeline start. File picker, drop, library and fetched URL sources must converge, including callers that bypass `handleFiles`. Clear/replace ownership correctly on Stop, new loads and unsupported sources. Capture the separate built-in demo as a descriptor. Do not serialize `lastAudioBuffer` or newer analysis internals as a replacement for original source files.
- [ ] Implement the live adapter with the module's actual `seekSong`, `togglePause`/audio state, loader, settings, recorder and export state. Preserve the existing loader's cancellation rules. Make the equivalent narrow adapter transformations for all pinned historical versions.
- [ ] Implement lazy source persistence, final-position capture after persistence, destination preflight and per-tab handoff transactions. If anything fails before navigation, keep the original page and recover its prior play state. Preserve file limits already enforced by the app.
- [ ] Add an active per-tab ownership lease with fresh document identity (Web Locks where supported, with an explicitly tested ownership fallback). Detect copied tab IDs and rotate the duplicate before it can consume pending state. Release ownership on pagehide and reacquire on pageshow. Test duplication during an idle session and during a pending switch; an in-memory flag or sessionStorage key alone is insufficient.
- [ ] Restore through the normal load path with a generation-bound intent. In `startConfirmedWorld`, set `startTimeline`'s restored seed/start/pause parameters and supply the saved audio offset to `playBuffer`; do not leave its existing zero offset. Clamp to duration and hold transport paused through readiness, verify within 100 ms, then apply the saved pause/resume state. Do not measure tolerance after resumed playback has advanced. Do not accumulate elapsed loading time or permit an audible zero-second burst. A paused restore must never become audible while initializing.
- [ ] Handle `bootAudioOnce`/resume denial before or after loading by keeping the source and intent and retrying from one explicit Resume tap. Handle `pageshow`/back-forward cache with the latest session record and source ownership; do not reload an already restored generation or resurrect a replaced file.
- [ ] Include tests for demo/unsupported source, missing range setting, recording/export/calibration blockers and a new source selected during preparation. Run Task 3 tests and commit.

## Task 4: HUD arrows and navigation behavior

**Files:** create `src/ui/VersionNavigation.js`, `src/ui/version-navigation.css`, `test/versionNavigation.test.js`; modify `index.html`, `src/ui/style.css`, `src/main.js`, and the shared historical bootstrap.

**Consumes:** manifest helpers, handoff store and session adapter. **Produces:** `mountVersionNavigation({ document, manifest, currentId, siteRoot, adapter, handoffStore, navigate }) -> { dispose }`.

- [ ] Write failing tests for previous/next URLs, endpoint disabling, double-click exclusion, blocked operations, manifest/preflight errors, correct target labels and Return to live. Assert navigation is not invoked before a completed handoff transaction.
- [ ] Mount the left arrow at the left extreme and right arrow at the right extreme of the HUD. Add a compact checkpoint label and title-screen placement using the same component. Reserve responsive space for all existing controls; keep mobile safe areas and focus outlines.
- [ ] Connect to the existing HUD wake/fade lifecycle, including historical adapters. Hidden navigation must be inert or have its descendants removed from the tab sequence. Hold the existing HUD timer while a navigation control is focused. Do not use a second timeout or global arrow-key bindings.
- [ ] Wire clicks to preflight/persistence/full-page navigation and boot-time restoration. Show target/loading/error state with a polite live region. Preserve explicitly compatible query/settings values; never forward transient export or diagnostic flags into ordinary version surfing.
- [ ] Ensure a hidden first tap only wakes controls. Recorder capture probes are excluded at the user’s request. Run Task 4 tests plus existing input/HUD/car-mode tests affected by the change. Commit.

## Task 5: Staged browser proof and release checks

**Files:** create `tools/version-browser-smoke.mjs`; add its command and dedicated CI gate; record compact evidence in `docs/evidence/version-browser/README.md` with screenshots/report and a short click-through sample.

- [ ] Serve the full staged site, not the source checkout. Run the same test under `/` and `/Midio-5/` prefixes. Load a deterministic pilot through the normal app input.
- [ ] On desktop, traverse all eight actual versions in both directions. Assert the declared source/adaptation hashes, resolved assets/workers, active expected renderer/scene kind, visible nonblank frame, zero unexpected console/shader errors and exactly one active app/audio stream. The live #399 entry and both circular entries must really differ on screen.
- [ ] At a nonzero position, verify same source/seed and position within 100 ms immediately after restoration, before playback advances. Test running and paused states, an ordered multi-file input, a source replacement, Browser Back/Forward, reload, a direct archive link and Return to live. Verify older versions use their own analysis/cache policy; do not promise pixel identity across analyses.
- [ ] On portrait and narrow mobile layouts, inspect both arrows with the existing control row, safe areas, focus, HUD timeout, first-tap wake and reduced motion. Test recording/export navigation blockers; omit recorder capture probes.
- [ ] Inject missing manifest/destination, IndexedDB denial/quota error, interrupted restore, rapid clicks, independent tabs and duplicated tabs with copied sessionStorage. Source audio remains recoverable, no cross-tab takeover occurs, and failed navigation presents a usable retry/return path.
- [ ] Run `npm test`, `npm run lint`, `npm run stage:versions`, and the new staged browser smoke. Run the existing bootstrap/audio playback checks against the same staged live root. Fix only concrete failures in scope; do not add landscape redesigns during verification.
- [ ] Measure the final artifact size and real deployment time; verify current GitHub Pages configuration serves the staged artifact containing `versions/`, rather than accidentally serving only the repository root. Record which checks passed and any browser gesture limitation honestly.
- [ ] Obtain a focused independent code review of handoff ownership, source fidelity, staging paths and UI behavior. Publish the implementation branch/PR with real screenshots and concise validation, then integrate according to the user's execution request.

## Suggested execution split for 6.1 Sol

Complete Task 1 first to fix the catalog and interfaces. Then staging/adapters (Task 2) and session/UI work (Tasks 3–4) can be delegated with explicit file ownership; one agent owns shared adapter edits. Integrate before Task 5. Do not launch eight full browser suites in parallel or duplicate the archive build in each existing smoke job.

The completion report should say which checkpoints can be browsed, whether song/position continuity passed, where the PR is, and whether deployment is complete. It must not report a version browser as finished based only on arrows being visible.
