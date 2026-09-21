# Graphics implementation ledger

Specification: supplied midio5-graphics-implementation-prompt(1)(1).md.
Baseline: current origin/main d5e1621fab44619edd1e7ee47783c9f8c7e89f57 (2026-09-21).
Isolation: fresh task-only clone, branch feat/world-identity-graphics. No existing changes.

## Plan and acceptance map

| Order | Requirement / current code | Task | Acceptance evidence | Status |
|---|---|---|---|---|
| 1 | worlds-smoke energetic audit uses return frame; generic music diagnostics | Pause, explicitly seek every labeled audit, record actual response and dimensions | Helper regressions, browser captures | In progress |
| 2 | WorldIdentity / PaletteSynth / WorldAdaptation / NearField | Enforce shared-boundary sky admission and world physical vocabulary, bounded world props | Behavioral adaptation/render tests; primary seed captures | Pending baseline |
| 3 | Repeated static strip/shading, particle and ground setup in world modules | Small behavior-preserving shared functions, separate commit | Pre/post controlled frames, ordering tests | Pending |
| 4 | Understory / Nave / Redline / Foundry art | Connected canopy; architectural glass/bays; road perspective; machinery assemblies | Composition intent and per-world before/after frames/motion | Pending |
| 5 | SalienceBudget / PerfGovernor | Retain essential structures, constrain competing foreground/light | All-world quality/accessibility matrix, measured costs | Pending |
| 6 | Verification / delivery | Full lint/unit/browser checks, final review and PR | Commands, artifact links, final SHA | Pending |

## Findings at current baseline

- Confirmed: generated palette physical fields use a common vocabulary; kind is a name prefix.
- Confirmed: NearField uses generated landmarkKey and large shared painters.
- Confirmed: Understory/Foundry omit astronomical=false and shared sky trusts this flag.
- Confirmed: Nave draws a generic celestial as its rose window.
- Already fixed: adapted edgeLight preservation, static shading geometry, integrated Redline travel, sustained furnace heat. Preserve these.
- Confirmed: WebGL is an overlay after Canvas (main.js renderer construction); no replacement/backend rewrite planned.

## Verification and environment

- npm ci: success (82 packages).
- npm test at baseline: 2803 passed, 0 failed (~23.4s).
- Local Chromium absent. npx playwright install chromium is timing out at cdn.playwright.dev. Existing browser CI is the fallback; no appearance changes before baseline captures.

## Decisions

- Ruling: use the fresh isolated clone on a feature branch, rather than a nested worktree; no unrelated work exists here.
- Pre-flight: the harness must precede identity/art changes; identity/prop interfaces must stabilize before refactoring; refactor comparisons use the identity-fixed state. Cathode stays separate.

### Harness prerequisite

- Added tools/world-frame.mjs, integrated in existing worlds-smoke.mjs; no renderer appearance changes.
- Regression: pre-seek scene used instead of reconstructed destination; assertion failed, then passed after seek-before-read.
- npm test: 2804 passed, 0 failed (15.6s); npm run lint: pass.
- npm run test:worlds: cannot launch (Chromium executable missing).
- Ruling: assert conductor rhythm in live playback; a paused destination reconstruction can legitimately contain no rhythm event. Capture reports requested audible time and actual led simulation time separately.
- Next: push this prerequisite, obtain CI baseline captures, then implement identity boundaries.
