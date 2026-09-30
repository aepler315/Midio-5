# Final desktop live playback timing

Three independent 15-second steady windows passed the specified desktop draw p95 ≤20 ms gate. Explicit controlled Teton/Muncho travel passed the ≤1.5× steady gate. These are measured normal audio-driven playback windows on the installed RTX 3060 Chrome/D3D11 runtime. They do not establish phone performance, natural fixture travel, or reproduction of the user’s original Auto complaint.

Source identity: pre-evidence HEAD `c3312b91ce384937be9bf2bf920c4c9039e1b1a5` plus the then-uncommitted production `src/world/BiomeManager.js` SHA256 `8b4ffa087d70a05c8ea4fae3b7231643730e931d06a8377078c6127e49cff29f`. The HEAD alone does not contain that fix. All 303 unique served src modules across accepted cases match local disk after the windows; exact map and union digest are in `baseline-browser/final-live-source-provenance.json`. Later Task7 SHA attribution must use source hash equality. Asset provenance is separately covered by Task7’s browser evidence manifest.

Runtime: headed Chrome `154.0.8037.58`, ANGLE NVIDIA GeForce RTX 3060 D3D11, driver `32.0.16.1088`. Viewport 1280×780, DPR1; stage Auto, cap 60, stage backing 1280×720, quality 0 throughout all accepted windows; revelation experience. Steady is pinned Teton Jackson Lake. Construction 315; hidden `seedInput` `0xADDE5713` receiver installed before deferred modules; actual song seed 2917029651 verified. Synthetic120s WAV SHA256 `0bbee2957cc72a3e4214a84c3bb67dac20871f9796be0e43014fc2da7224be85`. Lyric grounding disabled. No export or fixed-step calls.

The controller held other test/capture workers idle for timing. Native user preview tabs at 8194 and other OS applications were not controlled, so there is no OS-wide GPU-exclusive claim. No specific visibility/focus contamination was detected in the accepted isolated browser.

| Case | Actual audio window s | Draws/s | Draw p95 ms | Draw p99 ms | Max ms | GPU-region p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| pinned-steady 1 | 20.000–35.000 | 59.925 | 17.400 | 17.700 | 22.800 | 14.559 |
| pinned-steady 2 | 20.000–35.011 | 59.890 | 17.200 | 17.500 | 31.700 | 14.033 |
| pinned-steady 3 | 20.000–35.021 | 59.873 | 17.400 | 19.900 | 33.900 | 14.312 |
| pinned-steady-no-gpu-query-control 6 | 20.000–30.019 | 60.002 | 17.200 | 17.300 | 18.000 | disabled |
| controlled-distinct-view-travel 5 | 29.000–53.000 | 59.906 | 17.300 | 17.600 | 33.000 | 15.389 |

Controlled travel has 669 qualifying intervals. P95 ratio to the median steady-run p95 17.4 ms is `0.9943`; limit 1.5. The full controlled 24-second window draw p95 is17.3 ms, including settling periods. Travel buckets require active v2, distinct incoming ID, actual sideB target and seam 0.1–0.9 on both adjacent draws.

| Direction | Qualifying intervals | Heard bounds s | Draw p95 ms | GPU p95 ms |
|---|---:|---:|---:|---:|
| teton-jackson-lake->muncho-lake-south | 335 | 29.715–35.290 | 17.400 | 14.411 |
| muncho-lake-south->teton-jackson-lake | 334 | 41.732–47.290 | 17.300 | 16.360 |

Controlled travel is an external intervention in the isolated page: temporarily replace `sim.biomes.sections` and `RangePresentation.sceneByBiome`, prepare both approved views, retain production Simulation/camera/Auto/travel compositor and real advancing audio, and restore both original object identities at cleanup. Both views finished preparing at 20.939 s; the accepted future schedule is CONIFER/Teton 0–29 s, TAIGA/Muncho 29–41 s, CONIFER/Teton 41–53 s, then TAIGA. Bars 2000 ms preserve the production capped 7-second transition. Accepted measurement 29–53 s. The original attempted 20–44 s schedule was rejected for missing its first transition after preparation and is retained; this is not a matched 20–44 s claim. Natural sections remained all TAIGA before intervention.

Instrumentation samples draw start-to-start intervals, independent RAF, long tasks and asynchronous elapsed GL queries every 10 draws. Queries are polled later; no `gl.finish`, screenshot, synchronous readback or artificial clock stepping. GPU p95 reports completion of the instrumented GL region, excluding total-frame, compositor and scanout claims. Renderer/app/context identity is checked; rebind is allowed only outside recording after 5-second stable warmup. Every accepted run had no rebind, epoch 0→0, no identity change, no hidden/unfocused/fallback rows, no long tasks, zero invalid/disjoint or skipped queries, and at most one query pending. `analysisOpening` was null and terrain `allLoaded` true at preflight; analysis bin metadata fields sampled by the harness were absent and are not asserted.

No-query matching heard 20–30 s subset: queried steady p95 values17.4/17.2/17.5 ms; no-query p95 17.2 ms. There is no detectable p95 query penalty beyond this run-to-run spread. This short control retains draw/RAF attribution overhead and does not establish zero instrumentation cost.

Quality and backing regimes are preserved separately in raw JSON and compact summary. Every accepted sample stayed quality 0 and stage1280×720. Scenic overscan eased through 1402×842 to1408×848, so aggregate p95 is not the only regime evidence. Dominant 1408×848 regime had steady p95 17.4/17.2/17.4 ms and controlled p95 17.3 ms. Small transitional regimes contain33 ms maxima and p95 up to 24.6 ms; do not hide those behind the dominant regime or treat small-bucket percentiles as a separate stable-quality result.

Residency ledger (estimated resource accounting, not OS VRAM): each steady window starts/ends 109,610,199 live bytes, 178,324,954 historical peak, 268,435,456 budget, zero pending bytes/denials/overcommits. Controlled starts 189,043,055 and ends 188,744,523 live bytes, peak 264,332,599 (near the 268,435,456 budget), zero pending/denials/overcommits at both endpoints. Its 298,532-byte shaft target is released by the endpoint; two terrain CPU/GPU and material entries remain. Endpoint accounting does not prove lifetime peak outside the captured ledger or actual VRAM.

Served-source body retrieval errors are separated from source identity errors. Accepted runs had 0/1/1/4 duplicate body-read failures and controlled 1. Each failed canonical file also has a readable SHA matching disk; no unique unread module, hash mismatch or disk read failure was accepted. Exact duplicate URLs and errors are preserved. Clean source digest for steady/control 300 files is `dc19ef82af15b3a6c46a85aa3c0a71fc85a7808d685295d714002793763484b4`; controlled 303 files is `866c9b6c43d56c0e62c4e899f2ee9bab0ca4efa2137f424294c412da3cf75604`.

Preserved failures: initial `final-c3312b9-body8b4ffa-live-performance.json` contains an invalid zero-draw first window while audio/RAF advanced, stale external sampler identity suspected but not proven; two later measurable windows and early browser-close controls remain as originally recorded. A hardened sampler reran only the required final cases. `final-c3312b9-body8b4ffa-retry1-live-performance.json` keeps rejected controlled index 5 alongside the accepted steadies/no-query. Controlled-only bounded retry is `final-c3312b9-body8b4ffa-travel-retry2-live-performance.json`. No production code was edited to make timing pass.

Cleanup verified: draw instrumentation restored; controlled section/map object identities restored; isolated AudioContext suspended; contexts and owned Chrome intentionally closed. Server 8194 remains parent-owned for the user preview. Quiet window released at 2026-09-30T20:46:23.647Z after browser closure.

Reusable harness `baseline-browser/live-performance.mjs` records its own digest. Raw reports retain per-draw/query/RAF/regime/state rows and lifecycle events; `baseline-browser/final-live-performance-summary.json` is the compact derived report. Existing baseline raw report and fixed-step clips are unchanged. Earlier baseline steady p95 17.3/17.2/17.2 ms demonstrates similar cadence in this controlled fixture; final p95 17.4/17.2/17.4 ms should not be presented as an FPS improvement. Fixed-step clips remain visual correctness artifacts only.
