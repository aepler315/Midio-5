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

### Composition intent (before any art changes)

- Understory: trunks join an enclosing, irregular canopy with open gaps; filtered shafts land under those gaps. Retain broad canopy masses at every quality rung.
- Nave: connected pointed bays and piers frame a radial stained-glass rose. Glass remains geometry, not a celestial disc; phrase controls existing bay response.
- Redline: converging road edges and depth-scaled lane marks establish a corridor while preserving integrated cruise travel and side-scroll cast grounding.
- Foundry: connected frames, pistons and channels make existing sustained heat, machine strokes and pours legible. No astronomical source behind machinery.
- Stronger worlds: preserve Range ridge/mirage, Far Side primary, Fathom ceiling, After Hours districts, and Cathode raster. Change only confirmed vocabulary/foreground/hierarchy issues supported by captures.

Design choice: extend WorldIdentity with physical-content/foreground rules and constrain generated palettes during adaptation. Keep musical color/intensity controls. Use small shared static-strip helpers only after appearance comparisons are available; do not build a universal renderer.

### Regression preparation (uncommitted until baseline)

- Real Understory/Foundry -> BiomeManager._drawSky -> _drawStarfield tests fail with unwanted paint.
- Shared sky direct calls for all five enclosed kinds fail (six paint operations versus two expected).
- Four adaptation fixtures (sparse, sustained bass, dense pulses, sectional) fail at city receiving pollen.

### Baseline captured

- CI run 35661031062 at 6f69835811f81afc187137f7f95e5338e46e8002: all jobs passed, including complete browser suite.
- Original controlled primary frames: `.smoke/baseline/worlds/`; CI artifact 10666707464 (audio-smoke).
- Inspected nine-world energetic contact sheet: shared green sky/columns obscure Understory, Foundry, Nave; Nave has a plain disc; Redline lacks a visible corridor. Range ridges and Far Side primary are stronger. These are visual observations, not human preference acceptance.

### Identity implementation

- Existing WorldIdentity now constrains particle/effect/landmark vocabularies, celestial admission and foreground bounds.
- Synthesis and real adaptation retain music colors/intensity, constrain physical choices; custom retains kind. Stock primary radius is not substituted for generated radius (avoids enlarging Far Side's successful primary).
- Shared sky/starfield/deep-sky/celestial/moon boundaries reject enclosed astronomy even if callers omit flags.
- NearField retains sector seeds/spacing/scroll/cache; registered worlds use bounded street furniture, road signs, pipes, piers, roots, sea fans and rocks. Legacy direct callers retain their interface.
- Focused tests: 50 pass; lint pass. Full suite in progress.
- Full identity suite: npm test -> 2816 passed, 0 failed (14.8s). Final focused adaptation rerun and lint passed after radius preservation adjustment.

### Mechanics refactor (appearance-preserving commit)

- Extracted static strip placement + aligned shading, repeated particle blend/setup, ground transform/footing into WorldDraw.js. City window layering stays explicit; Range and Cathode stay untouched.
- Persistent STATIC_SHADE options avoid allocating a new options object for every strip shade call. No FPS improvement claim (not profiled).
- Existing actual world draw order/alignment tests pass. Contract scan extended to include shared helper; no coupling coverage removed.
- npm test: 2816 passed, 0 failed (15.7s). Correction: lint was still running when first reported; it failed on City groundView and an unused Redline input.
- Pixel comparisons against the identity commit remain pending CI artifacts; no tolerance changes.

### Refactor correction

- CI run 35662140636 failed: City groundView was omitted although wet sheen requires its distinct ground sequence. Preserve that sequence; remove unused shared-ground import. Remove unused Redline particle input.
- Added a complete City-frame regression (existing test stopped at first shaded strip): RED ReferenceError -> GREEN; 10 focused tests pass. Completed lint run passes.
- Identity CI produced artifact 10667855366 for pre-refactor comparison. Corrected refactor CI is required before visual-equivalence claims.

### Structures and hierarchy implementation

- Four world-owned signature painters are registered through existing WorldRegistry and drawn at explicit positions in each world's order. Shared `_drawSignature` is auditable; it does not define world geometry.
- Understory: connected roots/trunks/boughs and enclosing crowns. Nave: three pointed bays, radial glass panes and architecture-origin illumination. Redline: perspective corridor and depth-spaced lane marks using existing integrated travel. Foundry: braced frames, pistons, furnace mouths and channels tied to existing sustained heat/pour controls.
- Essential signature geometry has no quality gate. Browser harness now tests actual signature paint at level 0 and level 6/reduced motion, and captures 1.5-second fixed-step motion sequences.
- Shared SalienceBudget uses per-world support-light caps while leaving landmark/terrain at 1. Far Side adaptation retains a dark sky around its existing primary. Range/Fathom/Cathode geometry is retained; no arbitrary edits solely to change every world.
- Failing signature, salience and airless tests -> green. npm test: 2827 pass, 0 failed (14.8s). npm run lint and git diff --check: pass.
- Browser/art inspection, corrected-refactor equivalence, profiling, final review and evidence completion remain pending.
