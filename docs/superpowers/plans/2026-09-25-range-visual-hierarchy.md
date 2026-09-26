# Range Visual Hierarchy Implementation Plan

> **For agentic workers:** Use the existing parallel audit domains for implementation with disjoint function ownership, followed by integration and whole-branch review. Track completion here. User explicitly authorized implementation after audit and plan without intermediate approval gates.

**Goal:** Restore a strange, musical Range with unmistakable SpaceRidge, exposed dancing geography, readable materials, and verified browser evidence.

**Architecture:** Keep the Canvas pipeline and source-space descriptors. Replace ambient signature attenuation with composition/exclusion, fit scenic silhouettes through shared geometry, and give opacity one owner per paint operation. Preserve biome-side rendering and combine sides once.

**Tech Stack:** Existing plain JavaScript ES modules, Canvas 2D, Node tests, Playwright/Chrome. No new product dependencies.

**Spec:** `docs/range-visual-audit.md`.

## Global constraints

- Alpine corrections stay behind the world-kind boundary; other worlds retain their renderer paths.
- Preserve real source profiles, range labels, deterministic seeds, song timing, ground physics and character identity.
- Preserve local valley fog, curve-bound ground patches, light-space conversion and single-side full-opacity paint.
- No additional blanket salience layer; geometry/count/event ownership precedes opacity changes.
- Baseline is 3231263; refresh remote main before publishing a branch/PR. Do not merge automatically.

## Review focus

- Later procedural tiles and partial viewport features retain materials.
- Transparent side edges and half-way A/B seams do not leak the sky through opaque overlap.
- Quiet, reduced-flash and lowest-quality frames retain the signature and usable horizon.
- Wide/pulled-back views and broad real profiles use one fit for blit, materials and diagnostics.
- Capture identities describe actual served code and actual biome ranges, not requested labels.

## Task 1: Sky signature and competition

Files: `SpaceRidge.js`, `ConstellationWeaver.js`, `SkyEnsemble.js`, `alpine/LandscapePolicy.js`, a small alpine sky-composition helper if necessary; only sky orchestration/star/moon functions in `BiomeManager.js`; related tests.

- [x] Add failing tests for 120Hz onset/re-arm, steady reduced-flash presence, total incidental-figure cap, and deterministic spatial exclusion.
- [x] Remove the duplicated alpine SpaceRidge style/ambient chain. Give its own authored paint direct responsibility for distance and contrast. Restore a larger articulated slow form; preserve sun/moon occlusion and depth motion.
- [x] Reserve its corridor in generic stars/constellations; use explicit optional-system caps/exclusion and voyage priority. Avoid multiplying all decorations into a gray soup. Keep non-alpine behavior.
- [x] Run focused tests, report exact behavior; root reviews full-scene day/night images and refines only against evidence.

## Task 2: Scenic composition and skyline visibility

Files: new `alpine/RidgeComposition.js`, `_rangeDh`, shared horizon geometry and geometry setup in `BiomeManager.js`; `terrain/BiomeSet.js` only if source choice needs extending; geometry tests.

- [x] Add failing broad-wall, jagged-range, visibility, uniform-fit and non-alpine tests.
- [x] Measure source/window area and relief. Prefer open middle profiles where feasible, then use a shared uniform foot-anchored fit to keep smooth high profiles subordinate and protect meaningful rear crest width. Never independently stretch source samples or fake peaks.
- [x] Factor horizon point generation so paint and visibility read the same line. Use one fit for `_drawDancingStrip`, `_crestPoints`, material projection and fog; preserve preview behavior.
- [x] Export actual frame metrics for captured L2-L5/horizon masks; test partial-span occluders, travel and A/B ownership.
- [x] Inspect large-profile and 21-station browser results; adjust structural fit if visibility or motion fails.

## Task 3: Material and A/B correctness

Files: `alpine/RidgeSurfaceDraw.js`, `alpine/RidgeSurface.js`, side-composite/side-paint functions in `BiomeManager.js`, optional pure composite helper, tests.

- [x] Reproduce centered-light contrast loss, gully alpha inheritance, late-tile material loss and half-way seam transparency in failing tests.
- [x] Use the directional accent's actual bounded alpha; reset opacity for each primitive. Use palette gully/cover colors where appropriate.
- [x] Select descriptors in the coordinates of each visible tile with a bounded total budget; keep paired summit faces and connected source structure.
- [x] Combine full-opacity sides in premultiplied space before one source-over output so opaque overlap stays opaque. Retain each side's own palette/geometry.
- [x] Keep useful ground work; inspect after mountain fixes before adding ground coverage. Repair any recoloring loss without inventing texture.
- [x] Run focused surface, ground, fog, travel tests and inspect forest/dry/transition frames.

## Task 4: Honest evidence and integration

Files: `tools/range-landscape-smoke.mjs`, `tools/lib/landscape-fixtures.mjs`, `landscape-evidence.mjs`, `landscape-visibility.mjs`, `world-frame.mjs` where needed; `Renderer._drawFilmFinish`; capture tests and validation record.

- [x] Add failing distinct-station/case-ID and partial-mask tests. Reproduce the live range-ID failure and seed discrepancy.
- [x] Use a deterministic full-song capture clock, explicitly load every forced biome's real ranges, and record actual seed/time/range IDs. Implement named day/night/transition/geometry cases with real setup; reject unsupported claims.
- [x] Verify served module hashes against source, distinguish dirty candidate from baseline, and save before/after PNGs plus motion and metrics. Preserve the user screenshot privately.
- [x] Make film isolation disable the whole film pass, including wash/vignette, so pixel deltas mean what they say.
- [x] Inspect representative full-size frames and contact sheets; record the verdict and limitations in `docs/range-landscape-validation.md`.
- [x] Run `npm test`, `npm run lint`, `npm run stage:site`, dependency audit and relevant browser regressions. Review the entire diff independently, fix substantive findings, and refresh main.
- [x] Publish a GitHub branch/PR and verify remote contents/status. Public code and visual-evidence publication explicitly authorized on 2026-09-26.

Recovery completion: see `docs/range-landscape-validation.md` and the committed
evidence manifest for verified results, source snapshots, and limitations.
