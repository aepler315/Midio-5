# Range v2 progress

Plan: `docs/superpowers/plans/2026-09-29-range-geodata-master.md` (copied verbatim from the supplied package).
Reference image: `docs/evidence/range-v2/reference.webp` (1806×871, documentation only; never staged into `/src`).

## State

| Field | Value |
| --- | --- |
| Branch | `claude/amazing-brown-tbiycu` |
| Base | `b8a3d72b344792d149906449f1cd86d68df8cc2b` (= audited SHA; `origin/main` rechecked 2026-09-29) |
| Last completed task | 9 (materials integrated; Task 8 recorder-path evidence still open, see below) |
| Next action | Task 10 — ForestCover instanced conifers (near/mid) over the canopy texture (far) |

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

## Asset budget (60 MB ceiling)

| Item | Size |
| --- | --- |
| Ross Lake terrain package | 1.6 MB payload + 0.2 MB manifest |
| Shared data textures (10 x 512^2 lossless WebP) | ~7 MB |
| Three.js subset bundle | 0.54 MB |

## Measurements so far (SwiftShader, not device numbers)

- Export frame at 1280x720 with v2 active: ~430-710 ms draw in SwiftShader; partition copy (drawImage of the WebGL canvas) 0.1-0.3 ms.
- Desktop LOD for the pilot: 1.85 M triangles; mobile budget 0.80 M.

## Command log

- `node tools/build-range-scene.mjs --view nc-ross-lake-north --publish`
- `node tools/build-range-materials.mjs`
- `node tools/review-range-views.mjs --views nc-ross-lake-north --source published --stations 21 --modes neutral,silhouette`
- `node tools/range-scene-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" --expect-sha <sha> --suite pilot|export --output .smoke/range-v2`
