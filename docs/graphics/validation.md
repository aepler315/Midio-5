# Graphics validation

Baseline: current `main` at task start, `d5e1621fab44619edd1e7ee47783c9f8c7e89f57`. All nine worlds and their IDs remain. Cathode retains its raster/CRT pipeline. No backend rewrite, merge, deployment, or runtime dependency was added.

Final source: `2ed3cc86c92b244252d540dbe5e4d47e3289b50a`. [Final source CI](https://github.com/aepler315/Midio-5/actions/runs/35664965444) passed lint, all 2,841 unit tests, dependency audit, and both browser jobs. The final evidence commit adds only documentation/assets. [Actual capture configurations, signals and raw timings](evidence/final-capture.json) are retained alongside the images.

## Requirement-to-evidence map

| Requirement | Implementation | Evidence |
|---|---|---|
| Physical identity survives music adaptation | Existing WorldIdentity vocabulary, celestial policy, drift limits; PaletteSynth and WorldAdaptation admission | Actual adaptation across sparse, bass, percussion and sectional fixtures; actual ParticleField rise/drift regressions |
| Enclosed worlds reject astronomy | Shared sky, starfield, deep-sky, moon and celestial boundaries | Real world → shared sky → starfield regressions, browser negative paint checks |
| Foreground fits its world and preserves readability | Bounded street posts, roadside markers, pipes, piers, roots, sea fans and rocks; seeded occupancy independent of access order | Forward/backward/fresh-seek equivalence, no adjacent occupancy, actual draw-transform bounds and reduced-motion check |
| Captures describe the frame actually drawn | Explicit seek before audit, reacquired scene, actual response/signals, seeded synchronous construction, raw canvas PNGs | Three-passage matrix; configuration in final-capture.json; RNG restoration/repeatability regressions |
| Repeated mechanics consolidated without appearance change | WorldDraw static strip + aligned shading, particle blend, ground finishing; explicit world draw order retained | 69/69 exact RGB historical matches; complete City frame regression and alignment tests |
| Recognizable structures | World-owned canopy, vault/glass, perspective road, machinery/furnaces | Positive signature paint at levels 0/6, actual geometry tests, composed images and short motion inspection |
| Hierarchy and degradation | World support-light caps, dark urban/vacuum skies, bounded foreground; essential structure geometry retained | All-world reduced quality/motion captures and same-scene restoration; geometry identical across levels 0/6; Foundry occlusion and road/cast coverage regressions |
| Playback/export/selection preserved | No changes to audio timing or public world IDs | Existing full browser suite: upload/playback, lighting, shading, seek, worlds, export, car, pointer and keyboard chooser |

## Controlled comparison

The historical comparison isolates the mechanics refactor: identity-fixed `5e09a052a25b4583b77c30f68337941e4050e8a6` versus corrected refactor `0dfc85c09a35a1c4c8b0fd91427fbc37d9f234e3`, captured using harness `167d33b6da930ba4fd2e46da16524d7c3e70cb78` in [CI run 35663934900](https://github.com/aepler315/Midio-5/actions/runs/35663934900).

All 69 compared frames have identical RGB pixels: 27 primary passages, 9 degraded, 9 restored, and 24 fixed-step motion frames. No masks, excluded regions, or nonzero tolerance. Live reduced-motion smoke captures are intentionally excluded from equivalence because they are not at a controlled timestamp. [Hashes and raw timings](evidence/refactor-comparison.json) are retained here.

The 32-second 120-BPM fixture has a quiet opening/return and energetic middle. Requested audible timestamps are 6000, 18000 and 27000ms; actual simulation timestamps are 6052, 18052 and 27052ms because of the existing visual lead. Song and construction seed: 315. Viewport and backing store: 1280×720. Primary quality: 0, reduced flash: false. Degraded quality: 6, reduced flash: true. The harness restores quality to 0 on the same destination scene before another seek. Browser: headless Chromium 153.0.8010.12 on GitHub-hosted Ubuntu, Node 24.

Initial energetic comparisons differed because CameraDirector construction used unseeded randomness, and DOM screenshots included hover state. Investigation fixed capture construction and raw-canvas extraction; comparison thresholds were not widened. The production RNG is untouched outside the synchronous capture seek.

## Visual comparisons

The comparison images use the verified pre-art refactor as the top row and final art as the bottom row. Columns are quiet, energetic and return. This isolates deliberate art/hierarchy changes from the already-verified mechanics extraction. Original-main captures remain associated with baseline [CI run 35661031062](https://github.com/aepler315/Midio-5/actions/runs/35661031062); those early captures predate the RNG correction and are not exact pixel-comparison evidence.

| World | Visual decision / inspection | Comparison |
|---|---|---|
| Understory | Connected trunks/boughs support a continuous enclosing canopy; open gaps and the cast remain readable. Crown parity follows absolute scroll position. | [Frames](evidence/overgrowth-comparison.jpg) |
| The Nave | Pointed connected bays frame a radial stained-glass rose; illumination originates in the glass. Phrase-linked bay response remains. | [Frames](evidence/nave-comparison.jpg) |
| Redline | Pavement converges toward a horizon vanishing point and spans the cast travel line; depth-spaced lanes replace conflicting horizontal dashes. Integrated cruise and roadside reflectors remain. | [Frames](evidence/strip-comparison.jpg) |
| The Foundry | Braced frames, visible pistons, furnace mouths and pour channels replace an ambiguous skyline as the primary structure. Machinery shares the fixed ground transform and draws after ground so its lower light survives camera pull-back. | [Frames](evidence/foundry-comparison.jpg) |
| After Hours | Darkened generated sky yields to window districts, street lighting and urban props. Skyline geometry remains intact. | [Frames](evidence/city-comparison.jpg) |
| Far Side | Retained giant primary and hard dark background; physical vocabulary rejects terrestrial weather and foreground props are regolith blocks. | [Frames](evidence/airless-comparison.jpg) |
| The Fathom | Retained water ceiling/descending shafts, with enclosed astronomy admission and bounded underwater drift. No extra spectacle was added. | [Frames](evidence/abyssal-comparison.jpg) |
| The Range | Retained successful ridge/mirage path and hierarchy; foreground coverage is bounded. No symmetry-driven renderer extraction. | [Frames](evidence/alpine-comparison.jpg) |
| Cathode | Retained existing raster/CRT composition and dynamics. Inspection did not justify importing painterly changes or manufacturing a geometry edit. | [Frames](evidence/cathode-comparison.jpg) |

[Priority-world motion samples](evidence/priority-motion.gif) show six frames at 250ms intervals (90 simulation steps total per world). They include the existing short destination-reassembly veil after seek, followed by the settled scene. That transient is not a new world-geometry change. These are motion inspection aids, not a frame-pacing recording. [Quality comparison](evidence/quality-comparison.jpg) shows reduced quality/reduced flash and restoration on the same scene.

## Performance interpretation

The WebGL wrapper still calls the Canvas renderer first and adds its overlay. These changes do not replace Canvas work.

Historical same-run draw-submission sample: 90 frames per demanding world, 1280×720, quality 0. Timings surround `renderer.draw`, excluding screenshot readback. They are headless JavaScript submission measurements, not GPU execution time, presentation pacing, or device FPS.

| World | Before median / p95 ms | Refactor median / p95 ms |
|---|---:|---:|
| Redline | 44.95 / 49.2 | 45.0 / 49.2 |
| Foundry | 50.4 / 55.9 | 50.1 / 55.0 |
| Understory | 42.65 / 47.0 | 43.05 / 47.1 |
| Nave | 48.7 / 53.0 | 48.2 / 53.6 |

No material regression or speedup is supported by this sample. The refactor shares persistent shading options and avoids adding universal per-frame wrapper allocations. No speculative backend or GPU optimization was attempted. Final-art median/p95 submission ms: Redline 46.05/49.3, Foundry 50.6/56.5, Understory 42.65/49.0, Nave 48.95/53.3. Raw samples are retained in final-capture.json; separate-run differences should not be interpreted as causal performance gains.

## Reproduction and limits

Run `npm ci`, `npm run lint`, `npm test`; start `npm start`, then use the existing `test:lighting`, `test:shading`, `test:seek`, `test:worlds`, `test:export`, `test:car`, `test:chooser` and `test:chooser-keyboard` commands. `tools/worlds-smoke.mjs [url] [outDir]` writes configurations and PNGs. For historical pre-signature revisions only, set `WORLD_CAPTURE_REVISION` to the served commit SHA; this omits the unavailable signature pass requirement, retains sky/ground/negative assertions, and labels the report. Do not use this mode for current acceptance.

Local Chromium installation timed out; real-browser verification ran in existing GitHub CI. The final evidence covers representative fixtures and headless Chromium, not every song, browser, physical display or device. Automated conformance, integrator visual inspection, and human preference acceptance are distinct: no human holdout acceptance, universal FPS improvement, or photosensitivity certification is claimed. Destination-rebuilt particles are not required to replay the pre-seek history.
