# Range v2 progress

Plan: `docs/superpowers/plans/2026-09-29-range-geodata-master.md` (copied verbatim from the supplied package).
Reference image: `docs/evidence/range-v2/reference.webp` (1806×871, documentation only; never staged into `/src`).

## State

| Field | Value |
| --- | --- |
| Branch | `claude/amazing-brown-tbiycu` |
| Base | `b8a3d72b344792d149906449f1cd86d68df8cc2b` (= audited SHA; `origin/main` rechecked 2026-09-29) |
| Last completed task | 14 (transitions, framing, arrival fade, far-crest visibility) |
| Next action | Task 15 — curated views for the other 10 biomes (each must pass the far-crest gate before `--approve`) |

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
| 14 transitions/framing | done | View-to-view travel keeps the outgoing view and composites an incoming side (own target `range:render-target-B`, reserved before use, released after) through the shared travel seam (`src/world/TravelSeam.js`), nearest partition first; a loading/failed/unaffordable incoming view leaves the outgoing one drawing. `scenicProjection` keeps terrain at nominal pixels-per-radian under pull-back/overscan; DPR never changes framing; worst case (ZOOM_MIN + 64 px shake) is inside the extended bake. Mid-song legacy -> v2 handoff fades in over 1.2 s of heard time (legacy scenery drawn underneath; exports never fade). Far-crest exposure (legacy `MIN_EXPOSED` 0.55) measured on the shipped package at 21 stations and at 21 seam samples of every approved-view pair; `--approve` refuses a view below it. Ross Lake: 0.65-1.00 |
| (fix) approval identity | done | Review of PR #334: an approval now also covers the view's `materialRules` (key-sorted hash), hashes the published `.terrain.json` on disk rather than the build record's copy, and requires at least one existing evidence file. Ross Lake re-approved with the same evidence (catalog v3) |
| (fix) travel review round 2 | done | PR #334 second Codex round: the two sides blend in a reserved composition buffer (`range:travel-scratch`) with B added (`lighter`) so the feather stays opaque; a view that joins a travel late fades in over 1.2 s; the frame's resources are pinned before side B / the buffer are reserved; the app passes export mode to the presentation (the simulation never had it); travel exposure is checked at matching stations (both sides share the song's progress) and `--approve` checks every pair with the views already approved |
| (fix) travel review round 3 | done | PR #334 third Codex round: a late-joining view still fading when the travel ends keeps the A/B handoff (seam fully across) until its fade completes, and only a view some travel frame drew without counts as late; legacy-only passes (far shore, mirage, sea, sea life, horizon EQ) keep drawing under an arriving scene; exposure is measured per runtime partition from each shipped tile's own `band` (nearest-band masks), a travel composes the far/mid/near passes through their own seams (L2/L4/L5), and `--approve` also requires a far crest spanning half the frame at every station |
| 15 catalog | in progress | One candidate corridor per remaining biome, each on a range the app already classifies into that biome (see coverage table below) |

## Task 15 coverage (candidates)

One corridor per biome, chosen on a range that `RealBiomes.biomeOfRange` already puts in that biome, for a strong readable far crest. Summit checks compare the published height with the DEM maximum within 200 m.

| Biome | View id | Range (RESOLVE ecoregion) | Elevation source | Summit check |
| --- | --- | --- | --- | --- |
| RAINFOREST | `nc-ross-lake-north` (approved) | North Cascades | 3DEP 1/3" + Terrain Tiles | Jack Mtn 2763 |
| CONIFER | `teton-jackson-lake` | Tetons (South Central Rockies forests) | 3DEP 1/3" | Grand Teton 4199 / 4189; Moran 3842 / 3841 |
| ICEFIELD | `denali-wonder-lake` | Alaska Range (Rock and Ice) | Terrain Tiles z12 (the 3DEP query returned no Alaska coverage) | Denali 6190 / 6161; Foraker 5304 / 5313 |
| TUNDRA | `tombstone-north-klondike` | Yukon Ranges (Ogilvie-MacKenzie alpine tundra) | Terrain Tiles z12 | Tombstone 2192 / 2151 (located as the DEM maximum; the thin spire is under-resolved at z12 once the edge spikes are removed) |
| TAIGA | `muncho-lake-south` | Tower of London Range (Northern Cordillera forests) | Terrain Tiles z12 | lake located from the DEM (flat water mask) |
| PINE_OAK | `izta-popo-west` | Trans-Mexican Volcanic Belt pine-oak forests | Terrain Tiles z12 at 36 m (finer cells were refused as upsampled) | Izta 5230 / 5208; Popo 5426 / 5410 |
| BROADLEAF | `black-mountains-catawba` | Blue Ridge (Appalachian-Blue Ridge forests) | 3DEP 1/3" | Mitchell 2037 / 2036 |
| CHAPARRAL | `san-gabriel-baldy` | San Gabriel Mountains (California montane chaparral) | 3DEP 1/3" | San Antonio 3069 / 3068; Baden-Powell 2865 / 2864 |
| STEPPE | `white-mountains-owens` | White Mountains (Great Basin shrub steppe) | 3DEP 1/3" | White Mtn Peak 4344 / 4340 |
| CANYON | `la-sal-castle-valley` | La Sal Mountains (Colorado Plateau shrublands) | 3DEP 1/3" | Peale 3877 / 3876; Castleton Tower 2025 / 1965 (thin spire under-resolved at 22 m) |
| DESERT | `panamint-dantes-view` | Panamint Range (Mojave desert) | 3DEP 1/3" | Telescope 3366 / 3361 |

Terrain and material fixes found while reviewing these views (they apply to every view):

- **Spikes.** Terrain Tiles carried a cluster of fake 4200 m samples at the Tombstone grid's edge, and a few single-sample needles at Tombstone and Denali. The build now lowers any sample (or cluster up to three across) that stands more than 2 cell widths per ring step above its surroundings (~63 degrees) and records the count; no 3DEP view triggers it.
- **Dry flats.** A view can declare `water: false`; Badwater's salt pan was being marked as a lake.
- **Gentle-ground smoothing** (Terrain Tiles views only) softens resampling steps on flats; 3DEP views are untouched.
- **Cliff mask bug.** `smoothstep(max(40, forestMaxSlope - 6), forestMaxSlope + 10, slope)` inverts when a pack's forest limit is below 30 degrees (tundra, 20): every tundra flat was bare rock, and the rock detail texture tiled into a visible grid. The edges are now kept ordered (test in `test/rangeShaderSource.test.js`).
- **Alpine ground.** Above the treeline, rock now follows slope and convexity; gentle alpine ground stays meadow / tundra mat.
- **Surface normals** are taken from a bilinear surface across each tile's stored sample spacing, so coarse tiles no longer shade as flat triangle facets.
- **Snow** blends two unrelated tile scales; the snow/tree line breakup uses smooth value noise instead of a per-23 m-cell hash; drainage moss fades out on flats (filled-flat D8 routing is straight diagonal channels).
- A faint residual pattern remains on Tombstone's tundra valley floor at close range; recorded in its review.

Second review pass (colour in-app frames of all ten candidates):

- **Lake holes.** A tile's stride was chosen from height error alone, so a flat lake tile could fall to its four corners and ship half dry (Muncho Lake showed rectangular notches). A tile holding both water and land now keeps stride <= 4 (`SHORE_MAX_STRIDE`), and the surface texture draws water as the bilinear half-coverage contour of the four samples instead of the nearest sample (identical on stride-1 tiles). Re-baking changed only shoreline tiles: Tetons 18 of 251, Ross Lake 1 of 355; both were re-baked and re-approved.
- **Dry valley floors.** Steppe, canyon and desert packs placed 18-48 m conifers down to the valley floor (Owens Valley, Castle Valley read as dense forest). New optional pack rules: `forestFloorM` (lower forest limit, same stand breakup as the treeline, in placement and shader), `treeScale` (tree size), `airScale` (distance haze). Steppe 2000 m / 0.3, canyon 1700 m / 0.45, desert 1800 m / 0.3; pine-oak 2700 m (Mexican valley floors are farmland). Absent rules keep the old behaviour exactly, so the approved packs (wet-conifer, dry-conifer, icefield) are untouched.
- **Clear desert air.** `airScale` 0.5-0.6 for desert, canyon and steppe.
- **Broadleaf.** The treeline was 1600 m, so the Black Mountains' spruce-fir summits (Mitchell 2037 m) drew as bare ground; now 2300 m, with lighter deciduous canopy greens. The remaining grey at night is the shared night air over a dark forest, the same as the Tetons' forest.
- **Summer taiga and tundra.** Taiga snowline 900 m / treeline 700 m put Muncho Lake (817 m) above the treeline and under snow; now boreal forest to 1400 m and snow above 2000 m. Tundra snowline 1200 -> 1900 m. Both were indistinguishable from the icefield pack.

First placements that failed, and why: the Black Mountains from Craggy Pinnacle hid the far crest at 18 of 21 stations (nearer ridges; now seen broadside from the Catawba side); Muncho Lake's first eye sat in the mountains east of the lake; the Tetons from the east shore were too far for the range to read (moved over the lake).

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
- Far-crest exposure is measured on terrain only, at normal framing (16:9, zoom 1) with Midio's ground line (625/720) as the rock-stage occluder. Trees and the cast are not counted as occluders.
- In-browser A/B travel between two different real views cannot be exercised until Task 15 adds a second approved view; it is covered by unit tests (`test/rangeSceneTransition.test.js`) and the exposure check for every approved pair.
- The motion pilot is captured at 1280x720, 12 fps, 20 s: software GL needs ~9 s per frame (the bulk exporter's 1080p minimum is slower still).

## Measurements so far (SwiftShader, not device numbers)

- **Correction (2026-09-29):** the per-frame "draw" times recorded by the smoke tools (e.g. 430-710 ms) measure command submission only. The 2D canvas defers work, and SwiftShader performs it at pixel readback: a full 1280x720 v2 frame takes ~8-9 s to read back (`toDataURL`). Neither number is a device measurement; Task 16 must time on real hardware.
- Partition copy (drawImage of the WebGL canvas) 0.1-0.3 ms of submission.
- Desktop LOD for the pilot: 1.85 M triangles; mobile budget 0.80 M.
- Pilot residency with v2 active: 110 MB (terrain GPU 66, CPU 9, material 11, targets 22).
- Live playback (staged site, SwiftShader): the legacy -> v2 arrival fade started at 10.0 s heard time and was complete by the next live frame (13.1 s; frames were ~3 s apart). Resizing the window with v2 active kept the view active and the canvas filled edge to edge at 1280x780, 1600x900 and portrait 900x1400 (stage 900x506). The 1920x800 sample was never drawn because the 240 s song ended first (software frames took up to ~70 s at these sizes). An earlier all-black reading was the song's end, not a render fault.
- Rock stage mean sRGB: ~(50,63,61) at 30 s (moon up), ~(26,33,36) at 90 s; reference foreground rock ~(45,52,58).

## Command log

- `node tools/build-range-scene.mjs --view nc-ross-lake-north --publish`
- `node tools/build-range-materials.mjs`
- `node tools/review-range-views.mjs --views nc-ross-lake-north --source published --stations 21 --modes neutral,silhouette`
- `node tools/range-scene-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" --expect-sha <sha> --suite pilot|export|motion|complete --output .smoke/range-v2`
- `node tools/gen-pilot-wav.mjs <out.wav> 60` (calm/energetic/calm motion-pilot song)
