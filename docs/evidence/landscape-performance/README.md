# Landscape performance validation

The landscape is the default listening presentation from the first frame. Shared performers, their lights, trails, camera influences, captures and incidental animals/vehicles are absent. Natural terrain, vegetation, water and the separate Cathode boss remain. Historical `rangeExperience=revelation` and `rangeExperience=gameplay` URLs select this same presentation; there is no additional full-song wait for a reveal arc.

The actual analyzed source lanes and pitch confidence still drive the landscape. Ridge state is indexed by heard time and immutable analysis generations. A recorded provisional-to-final arrival is retained across seek, restart and export. Opening-only, historically blended and final-only sessions have different identities and must not be compared as though their inputs were identical.

## Reproduction

Start the exact checkout with `node tools/serve.js 8194`. Exact source fixtures are supplied separately as `landscape-validation-fixtures.zip` (19,385,024 bytes; SHA256 `e0fddc81af21e6c6844fec5b2da58649e04ba0760230043681fa0f8aea6aa9d5`). They are not included in a plain clone. Unzip the delivered archive and use its `fixtures/` directory below; `matched/` contains the separate comparison/timing input. The original generation recipe was not retained, so this archive preserves the actual input bytes instead of claiming a recreated byte-identical recipe. Individual hashes and availability are in [fixture-archive.json](fixture-archive.json).

The assembled tool accepts a directory containing `pilot-120s.wav`, `quiet-120s.wav`, `silence-120s.wav` and `authored-120s.mid`. Their SHA256 values are recorded in each matrix report. The matched clips use a separate `synthetic-120s.wav` input, whose hash is in the clip reports:

```sh
node tools/landscape-performance-smoke.mjs --url http://127.0.0.1:8194 \
  --fixtures /path/to/fixtures --output /path/to/evidence --suite all
node tools/range-revelation-smoke.mjs --url http://127.0.0.1:8194 \
  --wav /path/to/pilot-120s.wav --output /path/to/compatibility
node tools/bootstrap-smoke.mjs http://127.0.0.1:8194
node tools/seek-effects-smoke.mjs http://127.0.0.1:8194
node tools/export-smoke.mjs http://127.0.0.1:8194 /path/to/export v2
```

`PLAYWRIGHT_CHROMIUM_PATH` selects an installed browser. The assembled tool records actual GL identity, hashes readable loaded source responses against disk, asserts the actual seed/heard time and active renderer, and checks resource ownership. Use `--suite matrix`, `handoff`, `shared`, or `midi-travel` for independent cases. The current audio-only uploader rejects `.mid`, including on frozen main; the genuine-MIDI case deliberately runs the existing SMF parser/adapter, real Simulation and v2 renderer. It is not evidence of MIDI file-picker support.

Use `--suite matrix --case wide` for the targeted active-sun quality proof and dense accessibility/context-recovery checks. At 21 s, the harness asserts quality 0 has direct solar receiver light and an allocated shaft bundle, then renders quality 3 at the same heard instant and requires released shaft buffers/ledger ownership with unchanged actual scenic/stage light uniforms and essential resource keys.

The supplied HTML lacks the existing URL seed input receiver. Evidence helpers explicitly install a hidden receiver before module evaluation and seed construction randomness with 315. No served HTML/module response is changed. Final matched visuals use actual song seed 2917029651, Teton Jackson Lake, 960×540/DPR1/quality 0 and the same 20–40 s synthetic audio passage as frozen main `341a976`. Each descending-time sequence rebuilds the forward-only export clock. A 15 fps encoded clip is visual evidence, not measured playback FPS.

## Assembled correctness

The captured checkout is base `c3312b91ce384937be9bf2bf920c4c9039e1b1a5` plus the Task 7 body-color correction, before its evidence commit. The only modified production file was `src/world/BiomeManager.js`, SHA256 `8b4ffa087d70a05c8ea4fae3b7231643730e931d06a8377078c6127e49cff29f`; loaded source hashes in the reports identify the actual bytes. Actual installed Chrome 154/ANGLE D3D11/NVIDIA RTX 3060 rendered the final matrix. Wide 960×540/DPR1 and portrait 540×960/DPR2 cover opening, day, dusk, both gaps and moon. Quiet and silent recording fixtures cover opening/dense-clock positions. Dense reduced motion sets all physical deformation channels and both ridge displacement metrics to zero; reduced flash retains mountain motion. Quality 3 sheds shafts. Real context loss draws legacy and restoration resumes v2. All assertions require actual active v2 where expected, no page/shader errors and zero ledger overcommits.

Maximum captured application-owned residency was 136,504,039 B for wide and 176,793,079 B for portrait, within 268,435,456 B desktop budget. Portrait is desktop emulation, not Android hardware. These numbers measure application ownership, not driver VRAM.

A fresh targeted wide capture at base `3337b6fee7b20fee948ade4ac9cf67f23315c501`, with only the smoke harness dirty and production unchanged, strengthens the quality check in [quality-shed.json](quality-shed.json). Installed Chrome 154/ANGLE D3D11/RTX 3060 rendered quality 0 and 3 at the same 21 s active-sun heard instant. Quality 0 owned a 167,940 B shaft bundle; quality 3 released its buffers and ledger entry while retaining active v2, identical actual scenic/stage direct-light uniforms and the same essential resource keys. Actor/resource absence and zero overcommits passed throughout the targeted matrix, including its retained 42 s reduced-motion/reduced-flash checks and real context recovery. The new report records 300 served production-source hashes, exact original pilot fixture/seed and capture-time harness hashes. It supplements the original full [matrix.json](matrix.json), whose captured 42 s quality row was in a celestial gap; prior captured facts remain preserved. This is fixed-step correctness evidence, with no new live timing claim.

The genuine SMF fixture contains 1,032 MIDI events and actual authored source lanes. Real v2 geometry is sampled at 21 s, 42 s and 42.5 s. A controlled currentBlend fixture prepares Teton Jackson Lake and Ross Lake North as distinct views and renders the production A/B seam at 20%, 50% and 80%, with actual side-B allocation and zero overcommits. The ordinary synthetic audio has no natural chapter change; controlled travel must not be presented as natural song travel.

Shared-path coverage draws Fathom through Canvas and Far Side through the actual WebGL wrapper, with forbidden actor draw methods instrumented to fail. Cathode draws its actual boss once, with 399 sprite cells. Source/policy checks and rendered PNGs establish surviving world identity without adding the retired actors.

The controlled live analysis case delays only the existing 150 ms whole-song kickoff, identified by its loader stack. Actual provisional audio plays before release; the unmodified production callback records the final generation while audio continues. The previous immutable history is the same object, its recorded samples remain unchanged, and complete stateKey/sample/ridge/celestial state reconstructs inside the 500 ms handoff after pause, public seek, Restart and export. Public seek addresses the audio clock; the harness records measured compensation needed to target the same heard instant. Three duplicate worker response bodies canceled on worker termination are allowed only when the same URL has another readable response whose bytes matched disk.

The finished export smoke passed 18 checks: the HUD recording saved and decoded at 1280×720 for approximately 4.1 s, and the full-song car export saved at 800×480 for 20.5 s with correct letterboxing. Both files contain decoded audio and visible landscape pixels. Actor ownership is checked before and after recording. This independent export fixture uses seed 315; it is not the matched comparison session.

## Light and motion evidence

The assembled audit corrected an upstream color mismatch: physical sunlight had used a biome's decorative halo color. It now shares the rotated, blended authored body color with the celestial painter; decorative halos keep their own colors. Two regressions first failed, then passed, covering halo independence and the real body painter consuming resolved color. Final coherent receiver captures supersede prior color-producer evidence.

At the same 20 s camera/music/geometry, final facing-rock luma is 170.18 day, 129.50 dusk, 92.27 gap and 100.93 moon. Moon facing rock is 40.7% darker than day; shaded rock 18.8% darker and snow 31.1% darker. Facing red/blue decreases 1.504→1.341. This is actual receiver-pixel evidence with coherent authored sky/air/light states, not an inference from uniforms. Gaps retain zero direct key; readable ambient geography remains.

Prior fixed-camera motion evidence measured the dense physical far crest increasing 2→3 px, with 167→191 moving sampled columns and maximum source excursion 18.36→23.76 m. The geological ceiling remains authoritative; nominal 20 px calibration is not a claim that this distant view moves 20 px. The historical source identities and measurements are preserved in [motion-history.json](motion-history.json). Source-specific horizontal ridge multipliers are constant 2 or 3 across the three applicable motion paths, with finite endpoints. The final 20-second moving comparison retains these limitations.

Solar shafts use actual sampled terrain/foliage depth and the same final solar state. The accepted Task 6 aperture regression covers landscape, portrait and nonuniform backing: closed painted discs produce 0 shaft pixels, narrow limb openings admit bounded light. Real near occluders, moon and both gaps produce 0, while actual distant billboard coverage changes scattering. Essential light remains when shafts are denied or shed. The accepted historical source report is [shaft-aperture.json](shaft-aperture.json); the later Task 7 change only corrects body color, with current receiver pixels recorded separately. Those controlled occlusion cases establish correctness rather than broad artistic acceptance of every view.

## Validation boundaries

Full final production suite: 3,632 tests, 3,627 passed, 0 failed, 5 existing GDAL skips because Python GDAL bindings are unavailable. Lint, source diff whitespace, bundled runtime check and staged-site build pass. Expected failure-injection diagnostics in otherwise green tests are inherited and retained in logs.

Real desktop normal-playback measurements were captured in a separate window after production source froze: steady draw p95 was 17.4, 17.2 and 17.4 ms; controlled two-direction Teton/Muncho travel p95 was 17.3 ms across 669 qualifying seam intervals; the no-query control was 17.2 ms. The controlled travel schedule begins after view preparation and is explicitly recorded. This meets the measured desktop ≤20 ms steady and ≤1.5× travel targets for this fixture/hardware. It is not a natural-song travel claim. The [timing report](live-performance.md), [summary](live-performance-summary.json), [source map](live-source-provenance.json) and [raw archive](live-performance-raw.zip) preserve source identity, per-regime data, GPU-region scope and rejected attempts. Small overscan-transition buckets have p95 up to 24.6 ms and approximately 33 ms maxima; the dominant stable backing meets the gate. Controlled travel ledger peak is 264,332,599 B, close to the 268,435,456 B budget but without overcommit. User preview tabs and other OS apps were not controlled, so this is not a systemwide GPU-exclusive measurement. Frozen-main cadence was similar; these results do not establish an FPS improvement. No fixed-step, software-rendered or emulated result establishes a device timing target. Android timing and the actual pop/metal/long-progressive/quiet-recording artistic matrix remain unverified because hardware/source recordings were not available.

A developer-only VisionLoop still contains historical companion/character telemetry and reports absent jump BPM as 0. It is disabled by default and does not own listening actors, camera state or lights. That inherited telemetry is documented for review; this work does not change provider/schema behavior.

## Evidence index

| Evidence | Artifact |
| --- | --- |
| Verification, source identity and limits | [manifest.json](manifest.json) |
| Measured desktop playback, controlled travel and raw intervals | [live-performance.md](live-performance.md), [summary](live-performance-summary.json), [source hashes](live-source-provenance.json), [raw archive](live-performance-raw.zip) |
| Matched moving comparison | [before-20s.mp4](before-20s.mp4), [after-20s.mp4](after-20s.mp4), [before provenance](before-clip.json), [after provenance](after-clip.json) |
| Assembled v2, fallback and accessibility | [matrix.json](matrix.json) |
| Fresh active-sun quality shedding, actual receiver state and allocation | [quality-shed.json](quality-shed.json), [quality 0](quality0-sun.png), [quality 3](quality3-sun.png) |
| Actual live historical handoff and reconstruction | [handoff.json](handoff.json) |
| Genuine MIDI and controlled scenic travel | [midi-travel.json](midi-travel.json) |
| Shared worlds and preserved Cathode boss | [shared-worlds.json](shared-worlds.json) |
| Default and old URL compatibility | [compatibility.json](compatibility.json) |
| Existing pilot, software GL correctness only | [range-pilot.json](range-pilot.json) |
| Coherent final receiver pixels | [receiver-pixels.json](receiver-pixels.json), [day](receiver-day.png), [moon](receiver-moon.png) |
| Completed decoded exports | [finished-export.json](finished-export.json), [decoded car frame](export-decoded.png) |
| Historical reviewed motion/aperture measurements | [motion-history.json](motion-history.json), [shaft-aperture.json](shaft-aperture.json) |
