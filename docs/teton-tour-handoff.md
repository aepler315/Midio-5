# Teton Song Highway — environment handoff

Prepared 2026-10-08. **Resume the approved implementation plan; the feature is
not complete or available in the app yet.** The user requested finishing the
current highway step and then pausing for a new environment. That step is
committed and verified on synthetic terrain. Real Teton source downloads
remain blocked by the current environment's proxy.

## Read first

- Repository: `https://github.com/aepler315/Midio-5.git`.
- Authoritative plan: [2026-10-08-teton-song-highway.md](superpowers/plans/2026-10-08-teton-song-highway.md).
  The initial user path contained a space after the date; the actual filename
  has no space. The plan records the approved decisions; no separate spec is
  referenced.
- Progress and validation history: [teton-tour-progress.md](teton-tour-progress.md).
- Original checkout: `/workspace/Midio-5`, managed isolated branch `work`.
- Base on main: `bb098a38b7851f55bbc01642865499f32c3cb517` (plan PR #416).
- Last implementation commit: `0f5adb2bc31311eaf420c2efde2cfdc6f3982b9f`.
- These implementation commits have **not been pushed**. No implementation
  PR has been opened, and nothing has been merged or deployed.

Supply **the portable ZIP as well as this document** to the new environment.
The document alone does not transfer the unpublished code. The ZIP contains
an incremental Git bundle, a binary-safe patch, the original plan, progress,
the detailed execution ledger, and verification logs. `transfer.json` records
the final exported branch tip and archive contents; `SHA256SUMS` verifies the
individual files. It excludes dependencies, secrets, generated site output
and disposable caches. No real Teton DEM or GeoNames dump was available to
include.

## Restore the code

Keep any unrelated user changes safe and use an isolated branch. If the new
checkout already contains the implementation checkpoint and this handoff,
skip restoration. Otherwise, clone or open the repository and unpack the ZIP
into a separate directory. From the repository root, replacing the example
archive path with its actual location:

```bash
git status --short
git fetch origin main
git cat-file -e bb098a38b7851f55bbc01642865499f32c3cb517^{commit}
git bundle verify /path/to/teton-tour-handoff/teton-song-highway.bundle
git fetch /path/to/teton-tour-handoff/teton-song-highway.bundle work:refs/heads/teton-song-highway-resume
git switch teton-song-highway-resume
git log -7 --oneline
```

Use a different new branch name if `teton-song-highway-resume` already exists.
The bundle is incremental and requires the base commit above. If that commit
is missing from a shallow clone, fetch sufficient history first; for a
shallow clone, `git fetch --unshallow origin main` retrieves full history.
Read `transfer.json` to confirm the restored tip.

The patch is a fallback when bundle import is unavailable. It contains the
entire change since the base, including this handoff, but does not preserve
the individual commit history. Apply it only to a clean checkout at the
exact base on a new branch:

```bash
git switch -c teton-song-highway-patch bb098a38b7851f55bbc01642865499f32c3cb517
git apply --check /path/to/teton-tour-handoff/teton-song-highway.patch
git apply /path/to/teton-tour-handoff/teton-song-highway.patch
```

Do not apply the patch on top of the imported bundle. Review and commit the
restored patch after validation. The bundle is the preferred route.

## What is done and what remains

The plan's original task checkboxes have not been rewritten. Use this table
and the progress document to distinguish implementation from real-region
acceptance. Tasks were advanced independently while source access was
blocked; **Task 8 is complete and should not be redone**.

| Task | Status at handoff | Next acceptance or implementation |
| --- | --- | --- |
| 0 — baseline and reading | Complete | Recheck the new environment and applicable `AGENTS.md`. |
| 1 — whole-range terrain | Foundation committed, real data blocked | Normalize four DEM tiles; pass ten summit checks; bake provisional all-tiles terrain and record its size. |
| 2 — points and properties | Foundation committed, real data blocked | Build real names and points; audit unmatched prominent names and print the highest twenty. |
| 3 — roles and tiers | Foundation committed, real data blocked | Produce the real 44-primary table for user review; validate spacing, spread and backups. |
| 4 — clearance and stations | Foundation committed, real data blocked | Author and validate real stations, especially drop/chorus ring and height limits. |
| 5 — highway graph | Current step finished on synthetic terrain | Build the real graph and `docs/evidence/teton-tour/highway-stats.json`. |
| 6 — view-quality field | Scorer, workers, cache and stage wiring committed | Compute the real road/station field; record timings, best/worst views and size. |
| 7 — final packing | Not started | Final terrain strides, portable binary tour format, loader, hashes, budgets and candidate catalog entry. |
| 8 — section roles | Complete | Reuse the pure classifier and its twelve tests. |
| 9 — route planner | Not started | Fillet-aware graph routing, section sequence search, backups/orbits and speed feasibility. |
| 10 — timeline | Not started | Joint height/aim planning, exact hero locks, continuous poses, safety, seek and replan invariants. |
| 11 — Range integration | Not started | Mode UI/flag, scene pose provider, camera moves, deformation, sky, mist and tour tree-height cap. |
| 12 — windowed terrain/forest | Not started | Route-window LOD, residency, workers, safe lifecycle and triangle budgets. |
| 13 — evidence and PR | Not started | Real map and hero imagery, five-song smoke, final checks and fresh whole-branch review, then PR. |

Saved implementation commits, oldest first:

| Commit | Contents |
| --- | --- |
| `67cf74e` | Provisional terrain bake support and source/frame validation. |
| `6b26a5b` | Offline point extraction, names and role assignment. |
| `d0838cf` | Pure runtime section-role classifier. |
| `5fd6aee` | Conservative clearance, safe stations and parallel view scoring. |
| `0f5adb2` | Safe highway graph, turnaround joins and highway/field stage wiring. |

## Fix source access in the new environment

The old instance's latest observed cloud configuration was revision 30:
running, restricted outbound policy, package-manager preset, and
`allowed_hosts: []`. Earlier observed revisions 7, 27 and 28 also lacked
custom source hosts. Execution networking was enabled, but HTTPS CONNECT
requests to USGS and GeoNames still returned **403 Forbidden**. The real
terrain builder independently failed with `Tunnel connection failed: 403
Forbidden`. This establishes an effective network-policy blocker; it does
not establish filesystem or repository corruption.

Add these custom outbound hosts to the saved configuration used to create
the new environment, and ensure that configuration is actually applied to
the new running instance:

```text
tnmaccess.nationalmap.gov
prd-tnm.s3.amazonaws.com
s3.amazonaws.com
download.geonames.org
```

The cloud tool exposed in the old instance was read-only
`cloud_environment_environment_status`; it could report effective policy but
could not change settings or restart the environment. A saved draft or an
acknowledged UI change did not produce observed access in that instance.
In a managed environment, use the cloud-environment runtime skill, inspect
effective policy and then test actual requests before starting a long bake:

```bash
curl -sSI --max-time 15 https://tnmaccess.nationalmap.gov/api/v1/products
curl -sSI --max-time 15 https://download.geonames.org/export/dump/US.zip
```

An HTTP response from the origin is distinct from the old proxy CONNECT
failure; use a real source download/build to prove usable access. Keep the
managed proxy and CA configuration. No credentials are needed for these
public sources. If access still fails, diagnose the effective policy or use
local inputs; do not repeat questions asking whether the user wants to
continue. They have already authorized implementing the plan.

Local fallback inputs are the four USGS 3DEP 1/3 arc-second DEM tiles
**n44w111, n44w112, n45w111, n45w112**, plus the GeoNames US dump
(`US.zip` or extracted `US.txt`). Existing Jackson Lake pilot terrain and
the Ridgeview peaks list do not cover the required region and feature types.

## Set up and resume

The old environment used Node **24.19.0**, npm **11.9.0**, and 85 installed
packages. `/usr/bin/python3` supplied Python 3.13, GDAL **3.10.3** and NumPy;
the default `python3` was a different interpreter without GDAL. The tool's
`findGdalPython` detected the working interpreter automatically. The plan
names Python 3.12, but the available GDAL-enabled 3.13 interpreter passed the
projection integration tests.

```bash
node --version
npm ci --cache /workspace/.npm-cache
/usr/bin/python3 -c 'from osgeo import gdal; import numpy; print(gdal.VersionInfo())'
```

Adjust the cache path and interpreter for the new environment. If necessary,
set `MIDIO_GDAL_PYTHON` to its GDAL-enabled Python executable. DEM tooling also
uses `curl` and `unzip`. Do not add a runtime GDAL dependency.

Resume **Task 1 real-data acceptance first**, then complete Tasks 2–6 on the
actual region before Task 7. Existing algorithms may need tuning against
real terrain; record each justified change in the progress document. With
source access working, the current entrypoints are:

```bash
node tools/build-tour-names.mjs
node tools/build-teton-tour.mjs --stage terrain
node tools/build-teton-tour.mjs --stage points
node tools/build-teton-tour.mjs --stage stations
node tools/build-teton-tour.mjs --stage highway
node tools/build-teton-tour.mjs --stage field
```

Later stages currently call their prerequisite builders; running every stage
can repeat authoring. Use the individual stages to inspect acceptance results
and the source/field caches to avoid unnecessary recomputation. The default
field worker count respects CPU affinity and cgroup quota; `--workers N`
accepts a positive integer override.

For local inputs:

```bash
node tools/build-tour-names.mjs --input /path/to/US.zip
node tools/build-teton-tour.mjs --stage terrain \
  --input /path/to/USGS_13_n44w111.tif \
  --input /path/to/USGS_13_n44w112.tif \
  --input /path/to/USGS_13_n45w111.tif \
  --input /path/to/USGS_13_n45w112.tif
```

Pass the same four `--input` options to each downstream stage so it uses the
local normalization cache. `--names FILE` selects a names JSON built by the
names tool. Alternatively, `--dem-grid PREFIX` imports a normalized grid, but
its metadata must satisfy the exact frame, source-hash and ten summit
identity checks. Preserve the grid's sidecar files together.

Supported stages are currently **terrain, points, stations, highway, field**.
`--stage pack` does not exist yet. Keep provisional outputs in the default
`.terrain-cache/teton-tour/` directory; do not use `--publish` to ship a
stride-1 provisional terrain package before Task 7 and its budgets pass.
The real names/points review JSONs and evidence should be committed only
after they have actually been generated and checked.

## Code and interfaces to preserve

Read the implementations before defining Task 7's shipped schema; caches
are intermediate authoring data, not a runtime format.

| Area | Files and established contract |
| --- | --- |
| Terrain | `data/terrain/teton-tour.json`, `tools/build-teton-tour.mjs`, `tools/lib/terrain-bake.mjs`, `src/world/alpine/TerrainPackage.js`. `allTiles: true` bakes every tile without a rail and records finite `errorsM` for strides 1/2/4/8/16/32/64; `lod` is absent. Loader accepts legacy `lod` or error tables. Reject incomplete DEM coverage. |
| Source validation | Builder separates local and remote normalization caches, hashes local files and validates dimensions, cell size, origin, NAD83 transverse Mercator centre/axes and summit geographic identities. `checkSummits` finds the peak in a 200 m circle and requires published height within 25 m. |
| Points/names/roles | `tools/lib/tour-points.mjs`, `tour-coordinates.mjs`, `tour-roles.mjs`, `tools/build-tour-names.mjs`. Highest-first 8-neighbour prominence and plateau merging; isolation, cols, lakes, canyon breaks, buttes and measured properties. Streamed GeoNames input with source hashes. Deterministic, constrained role assignment with positive suitability. |
| Stations | `tools/lib/tour-stations.mjs`. `buildClearanceField`, `clearanceAt`, `stationFlyability`, `chooseStations`. A station contains `posM: [x,z]`, `yM`, `passHeadingDeg`, `ringM`, `offsetM`, `flyability`, `bestAim`, `score`; graph authoring adds `nodeId`. `bestAim` includes heading, pitch, horizontal FOV, subject identity and raw score/features. |
| View scoring | `tools/lib/view-quality.mjs`, `view-quality-worker.mjs`. `scoreEye(grid, points, [x,y,z], options)` scores an exact eye height. `buildViewQualityField` evaluates road/station samples at clamped AGL tiers, normalizes globally and packs heading lanes. Workers preserve order and share read-only arrays; caches hash the complete scoring input. |
| Highway | `tools/lib/tour-highway.mjs`. `buildHighway(points, {clearance, grid, water, ...})` returns updated `points`, `nodes`, `edges`, `candidateEdges`, `stats`, `rejected`. Road samples are `[x,z,floorY,ceilY]`, 25 m apart. Edges have `id`, `a`, `b`, `kind`, `spine`, `lengthM`; orbit edges additionally record `radiusM`, `orbitY`, `joinTurnMaxDeg`. A straight edge may use `minTurnRadiusM: null`. |
| Field geometry | `highwayFieldSamples(highway, {clearance, spacingM: 100})` returns shared `samples`, edge mappings `{edgeId, sampleIds, distancesM}`, and station mappings `{pointId, sampleId}`. Every station is included, even when it is between regular arc samples. |
| Section roles | `src/world/terrain/SectionRoles.js`. Pure classifier with lyric/cue precedence, form inference, drop/build evidence, `finalChorus` and cross-section stops. Lead evidence is active `MIDIO` note onsets from `Conductor.timeline`. No production Range mode hook is installed yet. |

The field uses five AGL tiers `[0,120,300,600,1000]`, removing duplicate heights
after ceiling clamping. Per tier, the 72 headings at 5° steps use 72 Uint8
quality values, 36 Int8 pitch values at 10° steps, 18 bytes of 2-bit FOV indices and 72
Uint16 subject IDs (`0xffff` means none). The subject IDs index the points
array. Raw exact-eye scores are not necessarily in `[0,1]`; field quality is
normalized over the whole field at the 99th percentile before quantization.

The current `.clearance`, `.highway`, `.field` and view-field cache files use
Node V8 serialization. **Task 7 must implement the specified portable,
little-endian manifest/payload format and runtime loader.** Do not ship V8
caches. Current CLI output stems are `teton-range-tour`; field diagnostics
are `.field.build.json`, and highway stats use the plan's evidence directory.

## Decisions and safety details carried forward

- The existing managed task branch provided isolation; another worktree was
  unnecessary. Inspect the new environment's state before choosing isolation.
- The region is 48 km east–west by 76 km north–south, 20 m cells, NAD83
  transverse Mercator centred at `[-110.83,43.75]`; axes are east `X`, up `Y`,
  south `Z`. Source-frame validation is binding.
- Role selection uses the plan's Gaussian distance/crest preference bumps
  and suitability-ordered backtracking to satisfy primary constraints. Reject
  zero-suitability or insufficient pools; tune only with real evidence.
- Clearance is conservative: maximum-filter radii include the DEM/field cell
  footprint, floors round up, ceilings round down, and arbitrary queries use
  maximum floor/minimum ceiling across four corners. The mask is derived
  habitat, not measured forest cover.
- The clearance envelope assumes trees no taller than **35 m**. Current
  ordinary Range trees can reach **48 m times treeScale**. **Task 11 must cap
  tour-mode trees at 35 m** while preserving ordinary Range behavior.
- Drop/chorus station candidates require the **300–600 m ring** and
  **−120…+80 m height offset**. Candidates outside that preference have zero
  weight; reject authoring if there is no safe positive-quality station.
- The highway uses directional 100 m A*, smoothing and 25 m validation,
  a 400 m minimum radius, a 150 m minimum vertical band and a 1 km boundary
  margin. Merged stations are rescored and checked at their new exact position.
- The **1.35 spanner stretch** compares the retained network with shortest
  paths in the safe unpruned candidate graph. Terrain constraints make a
  straight-line stretch guarantee inappropriate. Crossing junctions share
  nodes and are revalidated after splitting/smoothing.
- Degree-one stations have safe 600/900/1200 m radius turnaround candidates.
  The chosen loop accepts both road arrival and reverse departure with joins
  at most **120°**. Runtime circular junction fillets remain Tasks 9–10.
- **A stored station height generally is not one of the five AGL tiers.**
  Task 10 must inject/use the exact station height and best aim for hero locks,
  rather than silently snapping to the nearest field tier.
- Section inference discovers a chorus label before assigning roles, but
  tests drops before form choruses. Compare with ordinary non-drop choruses;
  repeated bass-heavy EDM cuts can still become drops without one. A repeated
  pre-chorus predecessor also needs rising-energy or short-link evidence so
  ordinary repeated verses remain verses. Lyric/cue precedence is retained.
- Synthetic foundations were advanced while downloads were blocked; no
  fixture, pilot asset or fabricated statistic counts as real-region evidence.

The full execution ledger is included in the ZIP as
`execution-progress.md`. In the original checkout it lives under ignored
`.superpowers/sdd/2026-10-08-teton-song-highway/progress.md`. Preserve it when
resuming; it records decisions and the partial terrain review fixes.

## Remaining invariants from the approved plan

The mode belongs in the root app's Range world and is Tetons-only. Normal
Range behavior and legacy terrain hashes must remain unchanged when the mode
is off. Runtime code must not import `ridgeview/`; the offline scorer port
credits its source.

The eleven roles have four primaries each (**44**) and at most fourteen
backups each (**154**), so at most **198** stations; one point has one role.
Runtime travel follows the highway without cuts. Poses are deterministic in
heard time, with clearance at 10 Hz and interpolation midpoints; replanning
freezes the past and next three seconds. Planning must fit within 60 ms for
a six-minute song. Section timing, long sections, short songs and seek parity
still need the plan's runtime tests.

Optic-flow limits are 0.03–0.3 radians/s; absolute speed is 15–320 m/s and
acceleration 12 m/s² (6 for reduced motion). Consult the plan for the complete
height, aim, yaw, climb, stop and dwell constraints. Tour camera moves are the
identity. Deformation fades from zero near the eye (within 1,500 m) to full
strength beyond 4,000 m, in both colour and depth. Sky/sun/cloud direction is
world-fixed, low valley passes have a mist cap, and forest/terrain use route
windows. None of these runtime changes is implemented yet.

Task 7 must retain stride 1 within 6 km of a road sample and stride 2
elsewhere, then prove terrain ≤18 MB gz, tour data ≤4 MB gz, additions ≤22 MB
and total `src/assets/range/v2/` ≤60 MB. Task 12 uses eight-second windows,
checks poses at 2 Hz and keeps at most three windows resident. The catalog
entry remains a candidate until real role/hero imagery is reviewed. Final
delivery is a PR with honest evidence; **do not merge or deploy**.

## Verification at the checkpoint

Fresh verification after the final highway/orbit fix:

| Command | Result |
| --- | --- |
| `npm test` | **3,806 tests passed**, 3 suites, 0 failures/cancellations/skips; 44.77 s. |
| `npm run lint` | Passed, zero findings. |
| `npm run stage:site` | Passed; `_site/` generated. |
| `node --test test/tourHighway.test.mjs` | **8/8 passed**. |
| `git diff --check` | Passed before the code checkpoint. |

Highway tests cover connectivity, south-to-north spine, clearance and radius,
station-pair candidate-metric stretch, real redundant-road pruning, stable
ordering, station merges, crossing junctions, orbits and field sampling. A
new test first reproduced a 180° orbit-arrival failure; the tangent-aware
join fix passed it. Other focused suites have 17 point tests, 5 role tests,
12 station/view tests, 12 classifier tests and the terrain package/regression
checks. All are included in the full suite.

The legacy terrain manifest and payload golden hashes remain covered:

```text
manifest 6da9dee5d92899724c7cf65f891d87795f69858dfadacec2a9fe613bbff97f26
payload  379c2a29503ca05803d8bb53dfbe60b0f0e26e64c15a17042680500b18c91595
```

Included latest logs: `verification/task5-suite.log`, `task5-lint.log`,
`task5-stage.log`, and `task5-final-focused.log`. Source failure and terrain
review logs are also included. Npm upgrade notices in these logs are harmless.
Tests that create local HTTP servers or exercise archive/version history
require ordinary execution networking; the first baseline attempt failed
under disabled networking, then passed after networking was enabled without
application changes.

One partial terrain review completed earlier, and its three important
findings were reproduced and fixed: non-finite errors from DEM holes, local
cache identity, and imported-grid frame validation. There has been **no final
whole-branch review**, no real summit or primary acceptance, no tour imagery,
no final asset budget proof, no runtime performance measurement and no device
validation. Passing tests do not imply the full feature is ready.

## Prompt to supply to the next agent

> Continue implementing `docs/superpowers/plans/2026-10-08-teton-song-highway.md`
> in Midio-5. Read `docs/teton-tour-handoff.md` and
> `docs/teton-tour-progress.md` first. Restore the attached Git bundle if the
> checkout lacks the unpublished commits; use `transfer.json` to confirm the
> tip. Follow applicable repository instructions and skills. The highway
> foundation is finished at `0f5adb2`, all 3,806 tests, lint and staging passed,
> and Task 8 is already complete. Tasks 1–6 still need actual Teton data and
> acceptance. First inspect the new environment's effective source-host
> policy and prove USGS/GeoNames access, or use the four local DEM tiles and
> GeoNames US dump. Resume the real terrain/summit acceptance, then points,
> roles, stations, highway and field before Task 7. Continue Tasks 7 and 9–13
> without repeating finished code. Preserve the exact-height hero-lock and
> tour tree-height safety decisions in this handoff. Record justified tuning
> and evidence, keep ordinary Range unchanged, and deliver a reviewed PR.
> Do not merge or deploy. Implementation is authorized; proceed without
> asking again whether to continue.
