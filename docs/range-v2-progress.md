# Range v2 progress

Plan: `docs/superpowers/plans/2026-09-29-range-geodata-master.md` (copied verbatim from the supplied package).
Reference image: `docs/evidence/range-v2/reference.webp` (1806×871, documentation only; never staged into `/src`).

## State

| Field | Value |
| --- | --- |
| Branch | `claude/amazing-brown-tbiycu` |
| Base | `b8a3d72b344792d149906449f1cd86d68df8cc2b` (= audited SHA; `origin/main` rechecked 2026-09-29) |
| Last completed task | 13 (pilot view approved, catalog v2); PR #332 merged to main |
| Next action | Task 14 — transitions A/B, framing (16:9, wide, portrait), opening warmup |

## Decisions recorded with the user (2026-09-29)

- Runtime asset ceiling: **≤ 60 MB** total under `src/assets/range/v2/` (plain files, no Git LFS).
- Materials: **hybrid**. Procedural, offline-baked colour ramps and masks everywhere; procedural detail on distant terrain; CC0 photo-scan **normal/roughness data only** (no scan albedo) for the rock stage and nearest terrain. Provenance recorded per file.

## Environment (this execution session)

| Capability | Status |
| --- | --- |
| Node / npm | v22.22.2 / 10.9.7 |
| Python + GDAL | `/usr/bin/python3.12`, GDAL 3.8.4, numpy 1.26.4, Pillow 10.2.0 (apt `gdal-bin python3-gdal python3-numpy python3-pil`). The default `python3` (3.11) has no GDAL bindings. |
| ffmpeg | 6.1.1 (apt) |
| Browser | Playwright Chromium 1194 at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (set `PLAYWRIGHT_CHROMIUM_PATH`). |
| WebGL2 | Available only through **SwiftShader** (software, `--use-angle=swiftshader --enable-unsafe-swiftshader`). No physical GPU and no phone: every frame timing from this session is software-rendered and **not** a device measurement. |
| Network | Terrarium tiles (AWS), USGS TNM API + `prd-tnm` S3, ambientCG API, npm registry reachable. Poly Haven download host returned 521. |

## Baseline (Task 0)

| Command | Result |
| --- | --- |
| `npm ci` | ok |
| `npm test` | 3228 pass / 0 fail |
| `npm run lint` | clean |
| `npm run stage:site` | ok |

## Audit findings re-checked at base

The four confirmed defects in plan §1 are re-verified in Task 1 against source before editing.

## Task status

| Task | State | Notes |
| --- | --- | --- |
| 0 baseline | done | 3228 tests at base |
| 1 quality/RNG/evidence | done | level-6 fixture captures now record actual 6; one final draw |
| 2 DEM normalize | done | 3DEP 1/3" COG windows + Terrarium fill (Canada), local tmerc, provenance per window |
| 3 bake + runtime bundle | done | heightfield tiles (documented deviation from explicit Float32 buffers for the 60 MB budget); occlusion-aware LOD |
| 4 corridor | done (geometry) | Ross Lake north pilot, 21 stations; Diablo/Baker Lake/Shuksan rejected with reasons |
| 5 selection | done | approved-only pool, 15/85, recency, explicit fallback; HOME_BIOME_FAIR_SHARE split |
| 6 travel + frame | done | sceneProgressAt == legacy fitted scroll; frozen RangeFrame; shared deformation |
| 7 residency | done | shared ledger incl. legacy strips; budgeted, generation-safe asset prep; staging verifies assets |
| 8 integration | done except recorder evidence | markers verified in main stage + real bulk-export MP4; recorder check timed out because software-GL live playback outran the 96 s fixture song — rerun with a longer song |
| 9 materials | done (pilot quality) | 11 packs, CC0 data maps + procedural; exposure calibrated to reference values; rock still reads smooth at 20 m spacing — revisit in Task 13 |
| 10 forest | done | 13 m lattice, stable quality subsets, instanced near conifers + far silhouette billboards; water rejection uses all four neighbouring samples |
| 11 rock stage | done | slabs on the rendered support curve every frame; broken ledges; pools level-tested on the slab and contained by its face; exact polygon wet masks. Found+fixed: y-down ortho camera culled every face; per-frame BufferAttribute leak |
| (fix) terrain shader | done | `triplanar()` called `triplanarRib()` before its definition, so the terrain program never linked in the app (only trees drew). Guarded by `test/rangeShaderSource.test.js` and shader-error detection in the scene smoke |
| (fix) residency | done | legacy strips for v2-covered biomes dropped/not prebaked: pilot 267 MB -> 110 MB of the 256 MiB budget |
| 12 reflections | done | single body draw into ordered source-over/lighter segments; mirror about each pool's water plane; clip = pool polygon ∩ slab top. Pilot pixel check: 124-129 px in pools, 0 elsewhere, paused re-render identical |
| 13 atmosphere/pilot | done | mist, secondary celestial + clouds; motion pilot 20 s @ 12 fps from 0 s (opening included), calm/energetic stills, backward seek 32 s -> 8 s returns to the identical rail position; `nc-ross-lake-north` approved against its terrain/material/camera hashes (catalog v2; a changed asset voids the approval). Evidence: `docs/evidence/range-v2/pilot-ross-lake-*.jpg` |

## Asset budget (60 MB ceiling)

| Item | Size |
| --- | --- |
| Ross Lake terrain package | 1.6 MB payload + 0.2 MB manifest |
| Shared data textures (10 x 512^2 lossless WebP) | ~7 MB |
| Three.js subset bundle | 0.54 MB |

## Decisions taken without asking (assumptions)

- Under v2 the painted sea, far shore, mirage and sea life are off (the view is inland; the reference has no sea). The sea still draws during a live tsunami/withdrawal so that hazard stays visible.
- Under v2 the glyph ground scatter is off: the world-anchored rock stage carries the speed read.
- Midasus is reflected only when she is within 220 px of her floor and not on a voyage.
- The motion pilot is captured at 1280x720, 12 fps, 20 s: software GL needs ~9 s per frame (the bulk exporter's 1080p minimum is slower still).

## Measurements so far (SwiftShader, not device numbers)

- **Correction (2026-09-29):** the per-frame "draw" times recorded by the smoke tools (e.g. 430-710 ms) measure command submission only. The 2D canvas defers work, and SwiftShader performs it at pixel readback: a full 1280x720 v2 frame takes ~8-9 s to read back (`toDataURL`). Neither number is a device measurement; Task 16 must time on real hardware.
- Partition copy (drawImage of the WebGL canvas) 0.1-0.3 ms of submission.
- Desktop LOD for the pilot: 1.85 M triangles; mobile budget 0.80 M.
- Pilot residency with v2 active: 110 MB (terrain GPU 66, CPU 9, material 11, targets 22).
- Rock stage mean sRGB: ~(50,63,61) at 30 s (moon up), ~(26,33,36) at 90 s; reference foreground rock ~(45,52,58).

## Command log

- `node tools/build-range-scene.mjs --view nc-ross-lake-north --publish`
- `node tools/build-range-materials.mjs`
- `node tools/review-range-views.mjs --views nc-ross-lake-north --source published --stations 21 --modes neutral,silhouette`
- `node tools/range-scene-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" --expect-sha <sha> --suite pilot|export|motion|complete --output .smoke/range-v2`
- `node tools/gen-pilot-wav.mjs <out.wav> 60` (calm/energetic/calm motion-pilot song)
