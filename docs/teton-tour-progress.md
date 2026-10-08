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

## Remaining work

Tasks 4–13 have not started. The real terrain/summit checks, points and roles,
highway, view field, asset budgets, planner and timeline, mode integration,
windowed terrain/forest, visual evidence and the PR remain unverified.
