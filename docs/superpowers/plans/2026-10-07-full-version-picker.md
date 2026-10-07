# Full Version Picker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Browse every runnable published visualizer version, folding UI-only revisions into the newest revision of their group.

**Architecture:** Build a chronological catalog from first-parent Git history. Store identical historical public files once by their Git blob IDs and serve original directory layouts through a service worker. A shared picker surrounds the original application in a same-origin frame; the latest application remains the default.

**Tech Stack:** Node.js, Git, browser ES modules, service workers, Playwright.

**Spec:** User request in this conversation: every version except UI-only changes, with the newest UI revision used.

## Global Constraints

- No arbitrary count or date cutoff; audit every first-parent commit.
- Preserve distinct visual revisions, including reversions; fold consecutive UI/build/documentation-only updates forward.
- Preserve original renderer, audio and asset bytes except URL portability and removing nested obsolete navigation.
- Keep large previous/next arrows synchronized with the application's HUD; provide searchable direct selection.
- Default to latest; allow deep links and browser back/forward.
- Ordinary npm start stages the full picker automatically; deployments publish the same tested artifact.
- Do not restore recorder probes.

## Review Focus

- Early versions with root-relative assets must resolve their own historical files under subpath hosting.
- Missing Git history must produce an actionable staging error rather than an incomplete catalog.
- UI-only changes after a visual revision must select the newest source SHA.
- Rapid switching must never leave two engines playing.
- Hidden HUD controls must be inert; opening the picker must keep controls usable.

### Task 1: Complete history catalog and shared storage

Files: tools/lib/version-history.mjs, tools/stage-history.mjs, test/version-history.test.mjs.

- [x] Write and run failing fixture tests for chronological grouping, newest representative, reverts and safe public paths.
- [x] Implement history enumeration, conservative UI classification with reviewed exceptions and a complete inclusion/folding audit.
- [x] Implement content-addressed staging with exact historical path maps, shared blobs, latest engine and an explicit byte budget.
- [x] Verify all map references exist and storage scales by unique blobs.

### Task 2: Picker and historical file serving

Files: src/ui/HistoryPicker.js, src/ui/history-picker.css, src/ui/history-worker.js, src/ui/history-shell.html.

- [x] Implement SW virtual directory resolution and historical root URL portability.
- [x] Implement searchable chronological selection, latest default, deep links, history navigation and HUD visibility.
- [x] Retain selected local files across frame changes and restore compatible playback state; report when an old engine restarts playback.
- [x] Verify representative early, middle and latest engines in a browser, source selection and rapid navigation.

### Task 3: Local startup, release validation and delivery

Files: package.json, tools/start-history.mjs, tools/serve.js, tools/history-picker-smoke.mjs, .github/workflows/{test,static}.yml.

- [x] Automatically stage on npm start; preserve direct source-only server for existing renderer validation.
- [x] Test full catalog in CI and test the staged Pages artifact once before upload.
- [x] Run lint, relevant unit/browser tests and full archive coverage checks.
- [ ] Publish the reviewed PR and merge the authorized implementation when CI checks permit.

## Verification

- The restored Friday renderer and source index match upstream main (#409).
- Full Node suite: 3,723 passes, 5 skips, no failures. Lint and workflow YAML checks pass.
- Archive audit: 337 visual versions across all 427 first-parent commits at the implementation head; 5,102 exact original shared Git blobs.
- Chromium covers chronological and direct selection, full search, original early/middle/latest engines, raw-song handoff, paused position, HUD fade, fullscreen selection and interrupted restoration. Root and project hosting use the same artifact.
- Historical engines restore through their original input controls, avoiding old adapter pause options retained by background analysis. Files remain owned by the surviving host realm.
