# Graphics implementation ledger

Specification: supplied midio5-graphics-implementation-prompt(1)(1).md.
Baseline: current origin/main d5e1621fab44619edd1e7ee47783c9f8c7e89f57 (2026-09-21).
Isolation: fresh task-only clone, branch feat/world-identity-graphics. No existing changes.

## Plan and acceptance map

| Order | Requirement / current code | Task | Acceptance evidence | Status |
|---|---|---|---|---|
| 1 | worlds-smoke energetic audit uses return frame; generic music diagnostics | Pause, explicitly seek every labeled audit, record actual response and dimensions | Helper regressions, browser captures | Implemented; corrected deterministic captures running |
| 2 | WorldIdentity / PaletteSynth / WorldAdaptation / NearField | Enforce shared-boundary sky admission and world physical vocabulary, bounded world props | Behavioral adaptation/render tests; primary seed captures | Implemented; regressions green |
| 3 | Repeated static strip/shading, particle and ground setup in world modules | Small behavior-preserving shared functions, separate commit | Pre/post controlled frames, ordering tests | Implemented; historical comparison running |
| 4 | Understory / Nave / Redline / Foundry art | Connected canopy; architectural glass/bays; road perspective; machinery assemblies | Composition intent and per-world before/after frames/motion | Implemented; composed visual review pending |
| 5 | SalienceBudget / PerfGovernor | Retain essential structures, constrain competing foreground/light | All-world quality/accessibility matrix, measured costs | Implemented; browser quality/motion review pending |
| 6 | Verification / delivery | Full lint/unit/browser checks, final review and PR | Commands, artifact links, final SHA | In progress |

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

### Review and capture correction

- Independent review reproduced canopy parity popping at a scroll wrap, unbounded generated drift reversing bubbles, and pre-existing cache-order-dependent foreground spacing. Regression tests failed before fixes and pass afterward.
- Crown parity now follows absolute tree index. Generated drift is bounded by world physics (3px/s for water/forest, 2px/s vacuum). Foreground occupancy derives from seeded eligibility runs independently of cache visitation.
- Art CI 35663047975 exposed a lighting-test stub missing `_drawSignature`. Fixture now invokes the real manager signature dispatcher, preserving the with/without-light comparison.
- Refactor image comparison exposed non-deterministic CameraDirector construction and DOM hover pixels. Capture scopes seeded randomness to synchronous seek (restored in finally), and saves raw canvas PNGs. No comparison tolerance was enlarged. Temporary historical CI repeats identity/refactor captures with this same corrected harness.

### Composed visual inspection and refactor proof

- Corrected historical CI 35663721702: 36/36 raw RGB frames exactly identical between identity 5e09a05 and corrected refactor 0dfc85c (all nine kinds × quiet/energetic/return/degraded). No masks or tolerances. Artifact 10668640778; comparison report will be retained in this directory.
- Art CI 35663721714: all jobs passed, including lighting, shading, seek, all-world, export, car and chooser browser checks. Artifact 10668560928.
- Inspected all nine energetic compositions and full Foundry frame: canopy/rose/vault/road/machinery are visible, but nearer terrain hides furnace mouths and the road misses the cast's horizontal travel line.
- Added failing actual draw-order and road-coverage regressions, then moved machinery in front of L5 and widened perspective pavement across the cast line. Removed conflicting old horizontal lane dashes; existing reflectors/signage and integrated travel remain.
- Local full suite after corrections: 2840 pass, 0 fail. Lint passes. Latest composed captures are still required.
- Temporary historical workflow removed after its comparison runs; the opt-in historical mode remains in the same harness for reproduction.

- Historical repeat with motion, run 35663934900: 69/69 exact RGB matches (27 passages + 9 degraded + 9 quality-restored + 24 motion frames); evidence/refactor-comparison.json retains hashes and raw submission samples. Median differences range -0.5 to +0.4ms. This is headless submission cost, not device frame pacing/GPU performance.
- After Hours energetic inspection showed a luminous generated backdrop competing with small window districts. Added failing actual adaptation test, then attenuated only its sky at materialization while preserving musical hue and localized lights. Full suite: 2841 pass; lint/diff check pass.
