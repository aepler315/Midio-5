# Teton Song Highway progress

Plan: [2026-10-08-teton-song-highway.md](superpowers/plans/2026-10-08-teton-song-highway.md).

The plan was added to main in `bb098a3`, after this workspace's initial
snapshot. The task checkout has been advanced to that commit. Work is on
the managed checkout's `work` branch.

## Task 0: baseline and reading

- `npm ci --cache /workspace/.npm-cache`: passed (85 packages). The default
  npm cache was outside the writable workspace; the existing workspace cache
  resolves that environment issue without changing repository configuration.
- `npm test`: **3,742 tests passed, 0 failed** (39.38 s).
- `npm run lint`: passed, 0 findings.
- `npm run stage:site`: passed; site staged in `_site/`.

The first test attempt ran with networking disabled. `archiveServe`, `serve`
and `version-history` failed or stalled under those restrictions. After
execution networking was enabled, the complete suite passed. No application
or test code was changed to resolve those failures.

Read the terrain package/baker, camera rail and projection helpers, Range
presentation/frame/scene camera and lighting paths, forest placement, cloud
sea, sky composition, chapter scheduling/refinement, terrain source tooling,
Range v2 progress record and Ridgeview viewpoint scorer. The plan's seven
`cameraPoseAt` call sites still match the checkout. The terrain baker already
computes stride errors, but requires a rail and culls rail-hidden tiles; tour
bakes need an explicit all-tiles path. Forest cover is a derived habitat mask,
not measured land cover, as documented by `ForestCover.js`.

GDAL bindings are available through `/usr/bin/python3` (GDAL 3.10.3), rather
than the default `python3`. The existing `findGdalPython` detects this without
an installation or a runtime dependency.

## Task 1: whole-range terrain (in progress)

The authoring configuration, opt-in all-tiles bake, loader validation, build
entrypoint and ten summit checks are implemented. The default bake retains
its pre-change manifest and payload hashes. Summit reports include published
and GeoNames heights, with attribution in `NOTICE`; the summit scan uses a
200 m circle. No real tour terrain has been baked or shipped yet.

A code review identified three input failures, reproduced by failing tests:
residual DEM holes produced non-finite stride errors, local rasters shared
the remote normalization cache, and imported grids were not checked against
the requested region. All-tiles bakes now require complete source coverage;
the builder validates the finished manifest before writing it. Local caches
are isolated by input type, file path and SHA-256 content. Imported grids
must match the requested dimensions, spacing, origin, centre, NAD83 transverse
Mercator CRS, east/south axes and summit geographic identities.

The focused terrain suite passes **29 tests, 0 failures**, including the
three review regressions and the unchanged default-bake hashes.

After the review fixes, the full `npm test` run passed **3,752 tests, 0
failures** (41.09 s). `npm run lint` and `npm run stage:site` also passed.

USGS and GeoNames source requests currently return HTTP 403 from the cloud
proxy. Execution networking is enabled, but the cloud destination allowlist
still excludes `tnmaccess.nationalmap.gov`, `prd-tnm.s3.amazonaws.com`,
`s3.amazonaws.com` and `download.geonames.org`. The user is enabling those
hosts; source access must be observed before the real-data bake can proceed.
The actual `node tools/build-teton-tour.mjs --stage terrain` attempt also
stopped at the USGS source request with `Tunnel connection failed: 403
Forbidden`. Task 1 remains incomplete: the real four-tile package, summit
acceptance results and asset size have not been produced.

## Tasks 2–3: offline points and roles (in progress)

Source access is still blocked after the continuation request. The active
cloud configuration now reports revision 27, still with an empty custom
allowlist. A retry after the user said "now try" again returned HTTP 403
for USGS and GeoNames.

The independent point and role authoring code is implemented:

- Highest-first 8-neighbour union-find prominence, plateau merging, coverage
  edge truncation and exact distance to the nearest higher cell, capped at
  20 km; retained peaks supply their key cols and parent links.
- Lakes of at least 2 ha, shoreline and cirque measurements, an exact
  Euclidean interior fallback for concave lakes, high-flow canyon breaks,
  low buttes away from the crest, and the plan's measured point properties.
- GeoNames filtering, streamed local/remote dump input, NAD83 projection,
  source hashes, name matching and an audit for unmatched prominent peaks.
- Role suitability formulas, scarce-first assignment, four primaries per
  role with spacing and range-third constraints, and at most fourteen
  spread-out backups per role. The points build prints the primary table.

The point suite passes **17 tests**, including a local GeoNames/GDAL build
fixture. The role suite passes **5 tests**, including 44 unique primaries,
spacing, range spread, named drop/chorus pools, backup caps and determinism.
These are synthetic contracts. The real point files, named-peak acceptance,
and the 44-primary table cannot be produced until Task 1 has source data.
`node tools/build-teton-tour.mjs --stage points` connects these stages.
After this checkpoint the full suite passes **3,774 tests, 0 failures**
(46.16 s), with lint and site staging also passing.

## Task 8: section roles (complete)

The pure runtime classifier maps sections to the eleven tour roles, with
trusted lyric kinds and explicit conductor role cues taking precedence.
Repeated form labels identify choruses; energy, bass share, transition,
duration and rising-energy evidence distinguish drops and linking sections.
Repeated verse labels stay verses unless they supply build or link evidence.
Active `MIDIO` note onsets provide lead density for solo/interlude decisions.
Qualifying silent spans are measured across the song before clipping them to
individual sections, and the last actual chorus carries `finalChorus`.

All **12 classifier tests** pass, including verse/chorus and EDM sequences,
lyric and cue precedence, missing bass evidence, lead-lane selection,
cross-section stops, determinism and input preservation. The full suite
passes **3,786 tests, 0 failures** (42.70 s); lint and site staging pass.

## Tasks 4 and 6: clearance, stations and view scoring (in progress)

The exact-height view scorer is ported to local metres, with curvature and
refraction, skyline ownership, face, fit, openness, drama, water and summit
visibility. It adds the plan's skyline lift, depth layers, relative subject
height and foreground terms. Field authoring evaluates all headings and
height tiers, normalizes over the whole field and packs the heading lanes.
Workers share read-only DEM arrays and preserve sample order; one-worker and
two-worker output matches. The content-addressed cache covers heights,
validity, water, subjects, geometry and scoring settings.

The clearance field uses 60 m cells and Uint16 decimetres. Maximum filters
include the cell footprint so narrow summits cannot disappear between cells;
arbitrary-position queries use the maximum floor and minimum ceiling of the
four corners. Floors include up to 35 m of trees, 10 m slack and 40 m margin.
The existing forest can produce taller trees, so Task 11 must cap tour-mode
tree height at 35 m. This does not change the default forest in this checkpoint.

Station candidates are scored at their exact height and require opposite,
safe 800 m flight directions. Drop and chorus candidates outside the required
300–600 m ring or −120…+80 m height offsets receive zero preference. Authoring
rejects a point with no safe positive-quality pass. `--stage stations` reads
the material rules, updates the review points and saves the clearance cache.

The **12 focused tests** pass: best views over the lake face west; high and
plateau views score lower; higher eyes reveal more ridge layers; clearance is
conservative across a narrow summit; chosen stations are safe; malformed
workers and unsafe stations reject authoring. The full suite passes
**3,798 tests, 0 failures** (41.20 s); lint and site staging pass.

The latest cloud snapshot is revision 28, still restricted with an empty
custom host allowlist. USGS and GeoNames probes still return HTTP 403. No real
stations, road field, timings, budgets or imagery have been produced.

## Task 5: highway graph (synthetic implementation verified)

The authoring graph has a directional 100 m A* search with the plan's floor
gradient, climb and turn costs. Roads use 30 m simplification, centripetal
Catmull-Rom smoothing and 25 m samples. Validation rejects roads with turns
tighter than 400 m, vertical bands below 150 m or positions outside the
1 km boundary margin. The graph retains the south-to-north spine, a minimum
spanning tree and the 1.35 spanner, merges close stations, creates shared
crossing junctions and gives degree-one stations safe turnaround loops.
Orbit orientation accepts both arrival and reverse departure with joins of
at most 120 degrees; runtime circular fillets remain Tasks 9–10.

All **8 highway tests** pass on synthetic terrain. They check connectivity,
spine direction, clearance, radius, station-pair stretch, redundant-road
pruning, deterministic ordering, merging, crossing junctions, orbits and
100 m field sampling with every station included. Spanner stretch is measured
against the safe unpruned candidate graph; it does not bound straight-line
flights across terrain. `--stage highway` and `--stage field` connect authoring
and write real evidence only after the source and summit gates pass.

The full suite passes **3,806 tests, 0 failures, 0 skipped** (44.77 s); lint
and site staging pass. No real Teton highway or field has been generated.
Source access still fails with an empty custom allowlist at revision 30.
The user requested a pause here and a portable handoff for a new environment.
The code checkpoint is `0f5adb2`. See [the environment handoff](teton-tour-handoff.md)
for transfer instructions, task status, source setup and resume commands.

## Remaining implementation and real acceptance

Tasks 7 and 9–13 have not started. The real terrain/summit checks, points and roles,
highway, view field, asset budgets, planner and timeline, mode integration,
windowed terrain/forest, visual evidence and the PR remain unverified.
