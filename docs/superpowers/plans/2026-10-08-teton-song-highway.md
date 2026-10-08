# Teton Song Highway: Implementation Plan

> **For the executing agent (gpt-6.1 sol).** This plan is meant to be complete:
> every decision the user made is recorded below, and the remaining choices
> come with a default. Work the tasks in order; each task lists the files it
> owns, its interfaces, its steps (checkboxes) and how to tell it is done.
> Where this plan names a number, it is a starting value. Tune it only when a
> test or a rendered frame shows it is wrong, and record each change in
> `docs/teton-tour-progress.md`. Do not merge or deploy.

**Goal:** A Tetons-only mode for **The Range** world. For the whole song the
camera flies a fixed network of air roads (the "highway") over the real Teton
Range. The highway runs past points (summits, sub-peaks, cols, lakes, canyon
heads), and each point is tagged with the song-section role it suits (chorus,
verse, bridge, solo, outro and so on). For each section of the uploaded song
the camera reaches a point with that section's role while the section plays,
travels between points only along the highway, and at every moment looks at
the best view available from where it is. Long sections pass extra backup
points of the same role so the camera never slows to a crawl.

**Architecture (one paragraph):** Everything about the terrain is computed
**offline** and does not depend on the song: the whole-range terrain package,
the point list with properties and roles, the highway graph, a clearance field,
and a view-quality field (best aims at several altitudes along every highway
sample). Everything about the song is computed **once when the song loads**:
section roles, which point each section visits, timing and speed along the
highway, then altitude and aim. All of this is baked into a camera timeline,
and the camera pose is a pure function of heard time: `poseAt(timeMs) ->
{eyeM, targetM, fovYDeg}`, the same shape as the existing `cameraPoseAt`.
Rendering reuses Range v2 (`RangeScene`, `TerrainMesh`, `TerrainMaterial`).
The work there is to replace the 2-point rail with a camera-path provider,
switch the terrain to level-of-detail chosen by distance along the route, and
make the canvas sky work for a camera that turns all the way round.

**Tech stack:** JavaScript ES modules, Node 24 (`node --test`), worker_threads
for offline compute, Three/WebGL2 through the existing Range v2 runtime,
Python 3.12 + GDAL for DEM normalization (`tools/terrain/normalize-dem.py`),
Playwright + SwiftShader for evidence renders. **No new runtime dependencies.**

---

## 0. Decisions recorded with the user (2026-10-08)

| Question | Decision |
| --- | --- |
| Where it lives | Inside Super Maudio World (root app), not Ridgeview. A **Range mode: Tetons-only**: The Range world locked to the Tetons for the whole song. The normal Range is unchanged when the mode is off. |
| Camera vs points | **The highway threads the points.** The road passes each point (over it or beside it at a set distance). At every spot on the road the camera aims at the best view from there, pulled toward the current section's point. |
| Highway shape | **Network with a spine.** A main road along the range, plus branches and loops. For each section the camera takes the roads to a suitable point with the right role. Any section order works. |
| Role rule | **Terrain matches energy.** Chorus = biggest, most dramatic summits; verse = mid shoulders and sub-peaks; intro/outro = low, calm places; bridge = the contrasting side or angle; solo = sharp spires; and so on (§3). |
| Extent | **Whole range, new bake** (~48 km E–W × 76 km N–S; §1). Every tile ships. |
| Roles | Base six: intro, verse, chorus, bridge, solo (= the app's `instrumental`), outro. The user added pre-chorus, breakdown and drop/climax, and asked for more. This plan adds **post-chorus** and **interlude** as roles, and **final chorus** and **stop** as modifiers (§3.1). |
| Count | **4 primary points per role**, plus backups (§3.4). |
| Altitude | **Follows the music** (low and calm in quiet sections, up toward summit height for big ones), **and the view must be quality-scored at several altitudes**. Altitude is chosen jointly from the music target and the measured view quality (§6, §9). |
| Camera freedom | The camera is **always on the highway**: no cuts or teleports, no user zoom or orbit, and no cinematic "moves" in this mode. |

The existing approved view `teton-jackson-lake` and its 2-point rail stay as
they are. The tour gets its own terrain package and catalog entry.

---

## Global constraints

1. **Deterministic in heard time.** `poseAt(t)` depends only on (song
   analysis, seed, tour asset). Pausing, seeking in either direction, export,
   quality level, DPR and window size never change the pose at a given time.
   No `Math.random`. Seed with `hashSeed`/`mulberry32` from `src/utils/math.js`.
2. **Never inside terrain.** At 10 Hz and at every interpolation midpoint, the
   eye stays above the clearance floor (§5.1), including the musical
   deformation bound and trees.
3. **Never stalls the show.** Planning runs within 60 ms on desktop for a
   6-minute song (measured in Node). If any tour stage fails, the frame falls
   back to the legacy Range painters with a recorded reason. That is the
   existing Range v2 failure contract (`RangePresentation.js` header).
4. **Normal Range unaffected.** With the mode off, every existing test and
   evidence hash stays the same.
5. **Asset budget.** `src/assets/range/v2/` stays at or under 60 MB in total
   (currently ~27 MB). The tour adds at most **22 MB** (terrain ≤ 18 MB gz,
   tour data ≤ 4 MB gz).
6. **Provenance.** USGS 3DEP is public domain (credit USGS). GeoNames names are
   CC BY 4.0 (credit in `NOTICE` and the catalog `credit`). Record source
   hashes the way `tools/build-range-scene.mjs` does.
7. **Runtime code never imports `ridgeview/`.** Port the logic you need into
   `tools/lib/` (offline) or `src/` (runtime), and credit the origin in a
   comment.
8. Follow the repo's commit hygiene. Commit only paths the task owns, and run
   `npm test` and `npm run lint` before every commit.

## Review focus (what a reviewer will try to break)

- A 10-minute song, a 50-second song, a song that is one long section, a song
  with 13 sections that alternate verse/chorus, a song with no tempo.
- Seeking backward from 200 s to 10 s and forward again: identical poses.
- Section list refined mid-song (full analysis or lyrics arrive late): poses
  already heard do not change, and the camera does not jump.
- A long outro (≥ 60 s): the camera keeps moving at or above the speed floor
  by passing backup points.
- A very short section (< 6 s) whose role's points are all far away: the
  camera stays on the highway and the plan stays feasible.
- The camera turns 180°: the sky, sun and clouds stay fixed in the world and
  do not turn with the camera.
- Low passes in quiet sections while the valley mist (`CloudSea`) is up.
- Mobile budget: triangle count and memory stay inside the existing caps.

---

## 1. Region and terrain package

**Authoring file:** `data/terrain/teton-tour.json` (new).

```json
{
  "id": "teton-range-tour",
  "regionId": "tetons",
  "biome": "CONIFER",
  "status": "candidate",
  "title": "Teton Range",
  "place": "Teton Range, Wyoming and Idaho",
  "dem": {
    "source": "3dep13", "fill": "terrarium", "fillZoom": 12,
    "centerLonLat": [-110.83, 43.75],
    "extentM": [48000, 76000],
    "cellM": 20
  },
  "materialManifestUrl": "materials/dry-conifer.json",
  "tour": { "roles": "see §3.1", "tunables": "see §12" }
}
```

- The extent covers lon −111.13 … −110.53 and lat 43.41 … 44.09: from Teton
  Pass, Mount Glory and Rendezvous Mountain in the south to Survey Peak and
  Mount Berry in the north, with Teton Valley (Idaho) on the west and Jackson
  Hole, Jackson Lake and Signal Mountain on the east. 3DEP tiles: `n44w111`,
  `n44w112`, `n45w111`, `n45w112`. `normalize-dem.py` already reads windows
  across tiles; confirm the `w112` tiles resolve.
- The local frame is the same as other views: transverse Mercator at the
  centre, **X east, Y up, Z south**, metres (`horizontalCrs` string as in
  `teton-jackson-lake.terrain.json`).
- **Bake every tile.** The existing bake ships only tiles visible from the rail
  (`tools/lib/terrain-bake.mjs`, `VISIBILITY`, `railStations`). The tour
  instead stores each tile's **stride error table** (max vertical error in
  metres for strides 1, 2, 4, 8, 16, 32, 64). The runtime then picks strides
  by distance (§10.4).
- **Two resolutions to fit the budget.** Tiles within 6 km (horizontal) of any
  highway sample keep stride-1 samples (20 m). All other tiles store stride 2
  (40 m) as their finest level. Because the highway does not exist until
  Task 5, Task 1 bakes everything at stride 1 and Task 7 re-packs (see Task 7).
- **Summit checks** (published height vs the DEM maximum within 200 m; fail
  the bake if |Δ| > 25 m): Grand Teton 4199, Mount Owen 3940, Middle Teton
  3903, Mount Moran 3842, South Teton 3814, Teewinot 3757, Buck Mountain 3627,
  Rendezvous Mountain 3337, Mount Glory 3065, Survey Peak 2824 (GeoNames
  values can differ by a few metres from the published ones. Record both.)

---

## 2. Point identification ("including the most minor of sub-peaks")

Pure module `tools/lib/tour-points.mjs`, run on the normalized grid (Float32
heights, 20 m).

### 2.1 Summits and sub-peaks by topographic prominence

1. **Sort** all valid cells by height, highest first (`Float32Array` of
   heights plus a `Uint32Array` of indices; sort the indices by height).
2. **Union-find sweep.** Visit cells in that order. A cell with no visited
   neighbour (8-neighbourhood) starts a new component whose peak is that cell.
   A cell touching one component joins it. A cell touching two or more
   components is a **col**. Merge them into the component with the highest
   peak, and give each lower peak `prominenceM = peakH − colH`,
   `keyColIndex = cell` and `parentPeak = the higher component's peak`.
3. Flat summits (equal heights) count as one peak: treat equal-height
   neighbours as connected before the sweep, or break ties by index order.
   Test this explicitly.
4. **Edge truncation.** A peak whose component never merges, or whose key col
   lies on the grid edge, has a key col outside the window. Set
   `prominenceM = peakH − min(window)`, `prominenceTruncated: true`. This
   applies to Grand Teton. Never compare a truncated value as if it were exact.
5. **Isolation:** for each kept peak, the distance to the nearest cell higher
   than the peak (ring search outward, capped at 20 km; capped means
   `isolationM: 20000, isolationCapped: true`).
6. **Keep** peaks with `prominenceM ≥ 15` and `isolationM ≥ 120`. These are the
   "most minor sub-peaks". Expect a few hundred to ~1,500 peaks. Log the count.
7. **Cols** come free from step 2: the key col of every kept peak with
   prominence ≥ 60 m becomes a `col` point (Lower Saddle, Paintbrush Divide
   and so on).

### 2.2 Non-peak points

- **Lakes:** connected components of the hydro-flattened water mask (the bake
  already marks water: `hydrology.water`). Keep components of 2 ha or more.
  The point is the component's centroid if it lies inside the lake, otherwise
  the interior cell farthest from the shore. Properties: area, shoreline
  length, surrounding relief (max height within 3 km − lake height), and
  whether it is a **cirque lake** (relief ≥ 600 m within 1.5 km on at least
  180° of bearings).
- **Canyon heads and mouths:** cells with flow accumulation ≥ 2^12 cells
  (`hydrology.flow` is log2 × 16) that sit on the break from steep ground
  (mean slope > 20° within 300 m upstream) to valley (< 8° within 300 m
  downstream). Keep one point per canyon (the cell with the most flow on each
  break). These matter for bridge and breakdown.
- **Buttes:** peaks from §2.1 whose height is under 2,500 m and which lie more
  than 3 km from the main crest (Signal Mountain, Blacktail Butte). Mark them
  `type: 'butte'`. They are intro and outro candidates.

### 2.3 Names

Build `data/terrain/teton-tour-names.json` from GeoNames (feature codes PK,
PKS, MT, MTS, LK, LKS, GAP, PASS, VAL inside the bbox). `ridgeview/tools/build-peaks.mjs`
shows the download and filter; port it to `tools/build-tour-names.mjs`. Match
a name to a point when it lies within 250 m and (for peaks) |Δh| ≤ 60 m.
Unmatched GeoNames peaks with prominence ≥ 30 m are a **test failure**: they
mean the extraction missed something (`ridgeview/data/peaks.json` already
lists 111 named summits near the Tetons; most should match).

### 2.4 Properties (every point)

| Property | Definition |
| --- | --- |
| `type` | `summit` (prominence ≥ 150), `subpeak`, `col`, `lake`, `canyon`, `butte` |
| `elevationM` | DEM height |
| `prominenceM`, `prominenceTruncated`, `isolationM`, `parentId`, `keyColId` | §2.1 |
| `relief2kmM` | elevation − min height within 2 km |
| `sharpness` | elevation − mean height on the 150 m ring, divided by 150 (a slope-like number) |
| `meanSlope300Deg` | mean slope within 300 m |
| `faceAspectDeg` | downhill bearing of the steepest 500 m sector |
| `side` | `east`, `west` or `crest` relative to the crest line (the polyline through the highest cell of each 1 km N–S band; `crest` = within 600 m of it) |
| `skyOpenness` | mean horizon elevation angle over 360° from 30 m above the point (low = open, high = enclosed) |
| `viewshedKm2` | area visible from 30 m above the point within 15 km (60 m test grid) |
| `waterWithin2km` | 0..1 water fraction |
| `fame` | 0 unnamed, 1 named, 1.5 named with prominence ≥ 300 |
| `grandeur` G | `0.35·rank(elev) + 0.30·rank(prom) + 0.20·rank(relief2km) + 0.15·rank(sharpness)`, ranks as percentiles over all points, then `× (1 + 0.15·fame)` and renormalized to 0..1 |

**Review output (not shipped at runtime):** `data/terrain/teton-tour-points.json`
lists **every** identified point with all properties, its role suitabilities
and the assigned role and tier. This is the user-facing answer to "identify
points … and assign them properties".

---

## 3. Roles

### 3.1 Vocabulary

| Role | Musical meaning | Terrain it gets |
| --- | --- | --- |
| `intro` | opening, usually quiet | low, open places that see the range from afar: valley floor, buttes, the south and north ends, lakes |
| `verse` | main body, mid energy | mid-grandeur sub-peaks and shoulders on the flanks |
| `pre-chorus` | build into a chorus | sub-peaks and ridges just below a big summit, uphill toward it (the approach) |
| `chorus` | repeated high point | major named summits (high G, named) |
| `post-chorus` | tail right after a chorus | satellites next to a big summit on the far or descending side, with the big summit still in view |
| `bridge` | the contrasting section | the other side or angle: west (Idaho) side, a cirque, a canyon head; anything whose `faceAspect` differs from the range's east face by > 90° |
| `solo` | instrumental lead (the app's `instrumental` with an active lead) | sharp spires: high `sharpness`, steep (Teewinot, Nez Perce, Cleaver Peak type) |
| `interlude` | instrumental link, no featured lead | cols and passes between big peaks; shelves |
| `breakdown` | sudden drop to quiet mid-song | enclosed low places: canyon floors, cirque lakes, high `skyOpenness` |
| `drop` | the biggest single moment(s) | the very top of G: Grand Teton first |
| `outro` | ending, usually falling | the intro family again, but preferring water and wide pull-away views (Jackson Lake, String/Leigh lakes, buttes) |

**Modifiers (not separate point pools):**
- `finalChorus`: the last chorus occurrence. It takes the highest-G chorus
  point still available (a reward term in §8.3).
- `stop`: a near-silent gap of 1.5 s or more inside the song. The camera
  brakes to the speed floor and holds its aim, staying on the road. A
  detector is in §7; the behaviour is in §9.4.

### 3.2 Suitability (offline, `tools/lib/tour-roles.mjs`)

Every point gets `suit[role] ∈ [0, 1]`. Use `bump(x; c, w) = exp(−((x−c)/w)²)`.

| Role | Formula (starting point) |
| --- | --- |
| drop | `G³ · [prom ≥ 150]` |
| chorus | `bump(G; 0.85, 0.12) · (0.6 + 0.4·[named])` |
| pre-chorus | `bump(G; 0.6, 0.15) · near(bigNeighbour, 2.5 km) · uphillTowardIt` where `bigNeighbour` = nearest point with G ≥ 0.8, `uphillTowardIt` = 1 if the point is 150–700 m lower and on the valley side of it, else 0.4 |
| post-chorus | `bump(G; 0.6, 0.15) · near(bigNeighbour, 3 km) · seesItBack` (the big neighbour is on the skyline from 30 m above this point) |
| verse | `bump(G; 0.5, 0.15) · [type ∈ subpeak, summit] · bump(log10(prom); 2, 0.6)` |
| bridge | `bump(G; 0.6, 0.2) · max([side = west], [cirque lake], [canyon], aspectContrast)` |
| solo | `rank(sharpness)² · rank(meanSlope300) · [G ≥ 0.45]` |
| interlude | `[type = col] · bump(G; 0.45, 0.2)`, else `0.5 · flatShelf` |
| breakdown | `(1 − G)·rank(skyOpenness) · [type ∈ lake, canyon, col]` |
| intro | `(1 − G)·rank(viewshedKm2) · distanceToCrestBump(4–12 km) · (0.7 + 0.3·[type ∈ butte, lake])` |
| outro | `(1 − G)·rank(viewshedKm2) · (0.6 + 0.4·waterWithin2km) · distanceToCrestBump(3–15 km)` |

### 3.3 Fallback compatibility (runtime uses this when a role runs out or is too far)

| Role | Fallback order (penalty 0.35, 0.6, 0.8) |
| --- | --- |
| intro | outro, breakdown, interlude |
| verse | pre-chorus, interlude, bridge |
| pre-chorus | verse, post-chorus, chorus |
| chorus | drop, post-chorus, pre-chorus |
| post-chorus | chorus, pre-chorus, verse |
| bridge | solo, interlude, verse |
| solo | bridge, chorus, interlude |
| interlude | verse, breakdown, bridge |
| breakdown | interlude, intro, outro |
| drop | chorus, solo |
| outro | intro, breakdown, interlude |

### 3.4 Assignment: primary and backup tiers

1. Each point gets one role. Fill the scarce roles first, in this order: drop,
   chorus, solo, bridge, breakdown, pre-chorus, post-chorus, interlude, intro,
   outro, verse.
2. For each role pick **4 primary** points greedily by suitability, under
   these constraints:
   - same-role primaries at least 2.5 km apart (drop: 1.5 km, because the
     Cathedral Group is compact);
   - across the 4, at least 2 different thirds of the range N–S, so every
     role is reachable from anywhere;
   - not already taken by an earlier role.
3. **Backups:** every other point gets `role = argmax suit` and
   `tier = 'backup'` if its suitability is at least 0.5 × the weakest primary
   of that role. Keep at most **14 backups per role**, the best by
   suitability and spread out (≥ 800 m apart). All other points are
   `tier: 'scenery'`: they appear in the review file and as aim subjects, but
   get no highway station.
4. Expect 44 primary and ≤ 154 backup points, so ≤ 198 stations.
5. Unit test: the drop primaries include Grand Teton; the chorus primaries
   include at least 2 of {Mount Owen, Middle Teton, Mount Moran, Teewinot,
   Mount Saint John, Buck Mountain}; no same-role primaries closer than the
   spacing; every role has exactly 4 primaries.

---

## 4. Stations (how the highway threads a point)

`tools/lib/tour-stations.mjs`. A **station** is the spot on the highway where
the camera passes its point (the "hero moment"). It is chosen offline by
scoring candidates.

- **Candidates:**
  - summits, sub-peaks, buttes: rings at {150, 300, 600, 1000, 1600} m × 24
    bearings (15°) × height offsets {−250, −120, 0, +80, +200} m relative to
    the point;
  - cols: through the col, at +80 / +150 / +250 m;
  - lakes: over the water at 60 / 150 / 400 m above the surface, centre and 4
    shore offsets;
  - canyons: along the canyon axis at 3 positions, 120 / 250 m above the
    floor.
- Drop any candidate below the clearance floor (§5.1).
- **Score** = `bestAimQuality(candidate)` (§6, at that exact height)
  × `flyability` (at least 2 open, roughly opposite directions within 30°
  where the floor stays below the candidate's height for 800 m: you can fly
  through) × `rolePref(ring, offset)`.
- **`rolePref` by role:**
  - drop and chorus: ring 300–600 m, height −120…+80 (at or just below
    summit level, looking across at it or past it);
  - solo: ring 150–300 m (a close pass);
  - intro and outro: ring ≥ 1000 m and height +200, or lake 150–400 m;
  - breakdown: lowest offsets;
  - bridge: bearings on the point's `faceAspect` side.
- **Store:** `station: { posM: [x, z], yM, passHeadingDeg, ringM,
  offsetM }`. `passHeadingDeg` is the flight direction through the station
  that maximizes flyability. The camera passes the station in that direction
  or the reverse.

---

## 5. Highway network

`tools/lib/tour-highway.mjs`.

### 5.1 Clearance floor and ceiling (60 m grid, shipped)

- `floorY(x, z) = max ground within 120 m + trees (35 m where landcover is
  forest, else 0) + deformationReserve + 40 m margin`.
- `deformationReserve`: in tour mode the musical terrain deformation fades to
  0 within 1.5 km of the eye (§10.5). The camera is always the eye, so the
  floor needs no reserve for it. Keep a **10 m** reserve for numerical slack.
- `ceilY(x, z) = max(highest ground within 5 km + 400 m, floorY + 600 m)`,
  capped at 4,700 m.
- Ship both as `Uint16` (decimetres above the quantization offset) in the tour
  binary.

### 5.2 Graph construction

1. **Nodes** = stations (§4).
2. **Spine:** order the drop and chorus stations by latitude. Run A* (below)
   from a south anchor (a station near Rendezvous Mountain / Teton Pass) to a
   north anchor (near Survey Peak / Mount Berry) through those stations in
   order. Penalize turning (curvature cost) so the result reads as one main
   road along the east front. Every spine segment is an edge.
3. **Branches:** for every other station, run A* to its k = 6 nearest stations
   within 9 km. Keep paths whose length is ≤ 1.6 × the straight distance.
4. **Pruning to a network:** take the minimum spanning tree of all
   candidates, plus the spine, then add edges greedily (shortest first)
   whenever the graph distance between their ends is more than 1.35 × the new
   edge's length (a greedy t-spanner, t = 1.35). This gives loops without a
   hairball.
5. **Merge** nodes closer than 150 m. Split edges where they cross within
   100 m of each other, creating junction nodes.
6. **A* cost** on a 100 m 2-D grid. Altitude lives in the vertical band
   [floor, ceil]; the road is 2-D:
   `step = ds · (1 + 2·max(0, |∇floorY| − 0.25)) + 0.5·max(0, Δfloor) + κ·turn²`.
   A climb gradient above 25% costs extra; going over the crest is allowed
   but expensive. κ = 30 m per rad² as a starting value.
7. **Smoothing:** Douglas-Peucker (30 m), then centripetal Catmull-Rom, then
   resample every **25 m**. Validate: minimum turn radius ≥ **400 m** (`R_min`);
   the vertical band is at least 150 m tall everywhere (`ceil − floor ≥ 150`);
   the path stays inside the grid with a 1 km margin. A failed edge is
   re-smoothed with a larger tension, then dropped with a logged reason.
8. **Connectivity test:** the graph is one connected component, and every
   primary station is reachable from every other.
9. **Turnaround loops:** at each station whose degree is 1, generate an orbit
   loop (radius 600–1,200 m, clear of the floor at the station's height ±150)
   so the camera can come back without a U-turn. Store it as an edge from the
   node to itself (`kind: 'orbit'`).

### 5.3 Junction fillets (applied at runtime when edges are joined)

When the route passes a node from edge A to edge B, replace the corner with a
circular fillet of radius ≥ `R_min`. A turn of more than 120° is not allowed
directly: the planner must use an orbit edge or a different neighbour. Write
the fillet as a pure function of (A tangent, B tangent, node) so the same
route always gives the same curve.

---

## 6. View-quality field ("best view at every point of the path, at different elevations")

`tools/lib/view-quality.mjs` + `tools/build-teton-tour.mjs` (worker_threads,
one worker per core, results cached in `.cache/teton-tour/` keyed by a hash of
the inputs).

Port the skyline ray-caster and frame scorer from
`ridgeview/src/core/viewpoints.js` (`marchRay`, `rayProfile`, `frameScore`,
`summitVisibility`). Change the coordinates from Web-Mercator pixels to the
local tmerc metres of the tour grid. Keep the Earth-curvature and refraction
term (`curvatureDrop`), because sight lines here reach 40 km.

### 6.1 Where it is evaluated

- **Samples:** every **100 m** along every edge, plus every station.
- **Altitude tiers** at each sample: `AGL ∈ {0, 120, 300, 600, 1000} m` above
  `floorY`, clamped to `ceilY`, with duplicates removed. Tier 0 sits exactly
  on the floor (the lowest safe pass).
- **Aims:** 72 headings (5° steps). For each heading, try hfov ∈ {40°, 55°,
  70°} and let `frameScore` choose the pitch, as Ridgeview does.

### 6.2 Score (per sample, tier, heading)

Ridgeview's terms, with "crest" meaning "any terrain point of G ≥ 0.4 within
25 km" instead of one range's crest box:
`own`, `face`, `fit`, `open`, `drama`, `water`, `summitVisible`, `fovPref`.

**New elevation-aware terms.** This is the "how should elevation be judged"
answer: altitude changes the view in specific, measurable ways, so score each
way separately.

| Term | What it measures | Formula | Why |
| --- | --- | --- | --- |
| `skylineLift` | Do the peaks rise above the horizon? | median skyline elevation angle in frame, `bump(angle; 7°, 6°)`; angles ≤ 0° score 0.15 | From too high, summits sink below the horizon and the range reads flat, like a map |
| `layers` | Depth: how many ridge layers are visible behind one another | count of distinct depth jumps (> 1.5 km) between visible skyline segments along the median ray, `min(1, layers/4)` | Height usually adds layers, up to a point; the haze then sells the depth |
| `subjectHeight` | Eye height relative to the subject (highest-G point near frame centre) | `r = (eyeY − subjectY)/subjectRelief`; `bump(r; −0.15, 0.35)` | Slightly below to level with a summit looks heroic; far above looks down on it |
| `foreground` | Is there near terrain for scale without blocking? | fraction of the frame's lower third that is terrain within 2 km, `bump(frac; 0.35, 0.25)` | Very low passes get this for free; very high ones lose it |
| `openness` | Already in `open` | | Height clears foreground ridges |

`quality = own^1.2 · face · fit · open^0.7 · (0.65 + 0.35·drama)
· (1 + 0.3·water) · (1 + 0.2·summitVisible) · fovPref
· (0.5 + 0.5·skylineLift) · (0.75 + 0.25·layers)
· (0.7 + 0.3·subjectHeight) · (0.85 + 0.15·foreground)`

Normalize to 0..1 by the 99th percentile over the whole field.

### 6.3 What ships (binary, little-endian)

For each (sample, tier):
- `score[72]`: `Uint8`, quality × 255 per heading (best over fov and pitch);
- `pitch[36]`: `Int8`, degrees, at 10° heading resolution (interpolate between);
- `fovIdx[72]`: 2 bits per heading (packed 18 bytes);
- `subjectId[72]`: `Uint16` per heading, the point id centred in that aim
  (0xFFFF = none). **If this pushes past the 4 MB gz budget,** store
  `subjectId` at 10° (36 entries) instead.

At ~4,500 samples × 5 tiers that is about 4,500 × 5 × 270 B ≈ 6 MB raw, about
2.5 MB gz. Check it against the budget. If it is over, raise the sample
spacing to 150 m on edges longer than 3 km.

### 6.4 Tests

- On the synthetic grid from `ridgeview/test/viewpoints.test.mjs` (copy it
  into `test/fixtures/`), the best heading from an eye east of the crest
  points west (220°–320°), and the score at a tier above the crest's
  `hq − 150` is lower than at a lower tier (the skyline-lift term works).
- `layers` increases with height on a terrain of 3 stacked ridges.
- The output is identical across runs with 1 worker and with N workers.

---

## 7. Runtime: section roles (song side)

`src/world/terrain/SectionRoles.js`: a pure function.

**Inputs:** `BiomeManager.sections` (fields used: `startMs`, `endMs`, `label`,
`relEnergy01`, `kind`, `kindConfidence`, `provenance`, `transition`), the
energy curves (`mgr.energyCurves`), the duration, the conductor schedule (if
present) and lead-note density per section (`NoteEvent`s cast to Midio/lead;
check `src/core` and `src/sim/MidioPerformer.js` for the current name of that
role).

**Output:** `[{ role, confidence, finalChorus, stops: [{startMs, endMs}] }]`,
one entry per section.

Apply these rules in order. The first rule that fires sets the role.

0. **Conductor cue** naming a role → use it (confidence 1).
1. **Lyric kind** with `kindConfidence ≥ 0.5`: intro/verse/chorus/bridge/outro
   map directly. `instrumental` → `solo` if lead density ≥ the song's 60th
   percentile and `relEnergy01 ≥ 0.45`, else `interlude`.
2. **Chorus label** = the form label with ≥ 2 occurrences and the highest mean
   `relEnergy01` (tie: more occurrences, then earlier).
3. **Drop:** a section with `relEnergy01 ≥ 0.9`, entered by a `cut`
   transition after a section with a rising energy slope, whose low-band share
   is ≥ the chorus mean + 0.1. At most 4. If it carries the chorus label, call
   it drop only if its energy is ≥ 0.1 above the other choruses.
4. **Pre-chorus:** a non-chorus section directly before a chorus or drop, with
   duration ≤ 0.6 × the median section duration and a positive energy slope;
   or a label that precedes ≥ 2 chorus occurrences.
5. **Post-chorus:** a non-chorus section directly after a chorus, duration ≤
   0.6 × median, energy within 0.15 of that chorus.
6. **Intro:** the first section, if `relEnergy01 < 0.45` or its label never
   recurs. **Outro:** the last section, if `relEnergy01 < 0.6` or its energy
   slope is negative.
7. **Breakdown:** not first or last, `relEnergy01 ≤ 0.3`, and the previous
   section is ≥ 0.35 louder.
8. **Bridge:** a label occurring once, positioned at 45–85% of the song, or
   with contrast to the previous section ≥ 0.25.
9. **Solo or interlude:** if lyrics exist for the song and this section has
   none: solo if lead density is high and energy ≥ 0.5, else interlude. With
   no lyrics at all, solo needs high lead density, a label that occurs once,
   and energy ≥ 0.55.
10. Otherwise **verse**.

**`finalChorus`** = the last chorus occurrence. **`stops`** = spans of 1.5 s
or more where the overall energy is below 6% of the song's 95th percentile.

**Tests** (synthetic section arrays): V–C–V–C–B–C–O → intro/verse/chorus…
with the third chorus flagged `finalChorus`; EDM build→drop×2; a song with only
`decorative` provenance (everything verse except intro and outro); lyric kinds
override form labels; conductor overrides everything.

---

## 8. Runtime: route planner (which point each section visits)

`src/world/terrain/TourPlanner.js`: pure, with no DOM and no GPU.

### 8.1 Speed in "optic flow" units

How fast a fly-over feels depends on speed relative to height above ground,
not on m/s. Use `ω = v / max(AGL, 80 m)` (per second).

| Limit | Default |
| --- | --- |
| `ω_min` (the "no crawl" floor) | 0.03 /s |
| `ω_max` | 0.30 /s |
| target `ω*(energy)` | `lerp(0.05, 0.22, relEnergy01)` |
| absolute `v` | 15 … 320 m/s |
| acceleration | ≤ 12 m/s² (≤ 6 with reduced motion) |

### 8.2 Hero times

Each section's hero time is the moment the camera is at the section's station:
`tHero = startMs + clamp(time of the energy maximum within [0.2, 0.6] of the
section, startMs + 2 s, endMs − 2 s)`. Sections under 4 s get no hero: they
ride through, and the planner treats them as part of the neighbouring
transition.

### 8.3 Sequence search (Viterbi over sections)

- **Candidates for section k:** the stations of role `r_k` (primary and
  backup), plus fallback-role stations (§3.3) with their penalty. Cap at the
  nearest 24 by graph distance from the previous candidates' union. For the
  first section, also a virtual start: any intro or outro station at
  `t = 0`.
- **Transition cost a → b**, with `L` = graph shortest-path length including
  fillets and `Δt = tHero(b) − tHero(a)`:
  - `ω̄ = (L/Δt) / meanAGL(path, tier 2)`;
  - `cost = 4·(ln(ω̄/ω*))² + 50·[ω̄ outside the bounds]·dist + 3·[b already
    used] + 0.3·[b is a backup] + rolePenalty(b) + 2·backtrack(a→b)
    − 1.5·G(b)·[finalChorus] − 1.0·G(b)·[role = drop]`.
- `backtrack` = the fraction of the path's length on edges already used,
  within the last 60 s of the route.
- Prefer unused primaries: occurrences 1–4 of a role should land on 4
  different primaries when the timing allows.

### 8.4 Backups for long sections (the user's "long outro" rule)

After the Viterbi pass, check every transition, and every section longer than
`T_dwellMax = 22 s`:
- **Too slow** (`ω̄ < ω_min`) **or** a section longer than `T_dwellMax`:
  insert **sub-heroes**: backup stations of the same role (then of fallback
  roles) placed between a and b, spaced in time no more than `T_dwellMax`
  apart. Choose them by a best-first search over stations within reach that
  brings every piece of the transition inside [ω_min, ω_max] and minimizes
  `Σ cost`. If no station fits, use an **orbit** edge around the current
  station (one or more laps) as filler.
- **Too fast** (`ω̄ > ω_max` for every candidate): re-run with that section's
  candidates widened to fallback roles. If it is still infeasible, mark the
  hero `passedAtRange: true`: the camera stays on the shortest road and
  treats the moment when the point is nearest the frame centre as the hero
  moment. Never cut or teleport.
- Record each decision in the plan (`plan.notes[]`) so the debug overlay can
  show why a backup was used.

### 8.5 Speed profile between heroes

Arc length `s(t)` from `s(tA) = 0` to `s(tB) = L`:
`ds/dt ∝ w(t) = 0.6 + 0.8·energy(t)` (smoothed energy curve), normalized so
the integral gives L. Then enforce continuity: the speed at each hero is the
mean of the two neighbouring segments' local speeds, with cubic Hermite
blending, then clamped by the acceleration limit. Iterate twice. Use the same
idea as `ProfileTravel.terrainScrollPx` (an energy-integral rate), but over
the whole route rather than a strip.

**Tests:** the long-outro case (one 70 s outro after a chorus) uses ≥ 2
sub-heroes, and `ω ≥ ω_min` at least 98% of the time. A 4 s chorus right
after a verse stays on the road. Planning is deterministic (two runs give
equal bytes). Planning time for a 6-minute, 13-section song is ≤ 60 ms in
Node.

---

## 9. Runtime: altitude and aim (the camera timeline)

`src/world/terrain/TourTimeline.js`.

### 9.1 Joint altitude and aim choice (dynamic programming)

- Time steps every **250 ms**. At each step the route gives a position on the
  road (2-D) and its field sample (nearest; interpolate the two neighbouring
  samples).
- **States** = tier (≤ 5) × aim candidate (≤ 6): the top 4 local maxima of
  `score[72]` at that tier, plus "aim at the active point" and "aim along the
  direction of travel". About 30 states per step.
- **Objective (maximize):**
  `Σ [ quality(tier, heading) · (1 + 0.6·subjectBias) + musicAlt(tier) ]
  − 0.002·(Δheading°)² − 0.00002·(ΔY m)²`,
  plus hard limits: yaw rate ≤ 25°/s (12°/s when calm, energy < 0.3, or with
  reduced motion) and climb rate ≤ 30 m/s.
- `subjectBias`: 1 when the section's active point projects inside the centre
  40% of the frame for that aim, falling to 0 at the frame edge. It is
  strongest on the approach, peaks at `tHero`, and fades over the 3 s after
  it. The next section's point fades in over the 4 s before its section
  starts. This is "pulled toward the current section's point".
- `musicAlt(tier) = −((AGL_tier − AGL*)/250 m)²` where
  `AGL* = lerp(120, 900, energy)`, adjusted by role: drop and chorus aim the
  **eye height** at `subjectY − 50 … +150` (summit level); breakdown 100 m;
  intro and outro 600–1,000 m (pull away); solo 150–300 m (close and fast).
- **Hero lock:** for ±1.5 s around `tHero`, restrict states to the station's
  stored height tier and its best aim. At the hero the camera has the
  station's best view **exactly**.

### 9.2 Smoothing to continuous curves

- **Altitude:** zero-phase smoothing (forward and backward critically damped
  filter, time constant 1.2 s) of the chosen `Y`, then clamp to
  `[floorY + 5, ceilY]` at 10 Hz.
- **Heading and pitch:** unwrap, then zero-phase Gaussian (σ = 0.6 s), then
  rate-clamp.
- **Target point:** `eye + forward · D`, where D = the distance to the
  subject if there is one, else 12 km (keeps the `{eyeM, targetM}` contract
  of `cameraPoseAt`).
- **fov:** the chosen hfov converted to fovY for 16:9 (as Ridgeview's
  `vfovFor`), then smoothed (σ 1 s). Framing for other aspects stays a
  projection concern (`scenicProjection`).

**About "exactly the best view":** a camera that snapped to the
highest-scoring heading at every sample would jitter whenever two views score
alike. The DP keeps the aim on the best view wherever turning to it fits
inside the rate limits. Where it does not, it picks the sequence with the
best total. Measure this (§13): the mean chosen-aim quality must be ≥ 0.8 ×
the per-sample maximum.

### 9.3 Storage and `poseAt`

- Keyframes at **10 Hz**: `Float32Array`s `eye[3n]`, `target[3n]`, `fov[n]`,
  plus `Uint16` meta (`tier`, `activePointId`, `roleIndex`, `flags`).
- `poseAt(timeMs)`: Catmull-Rom on eye; slerp the forward direction between
  keyframes and rebuild the target at the interpolated D; linear fov. Clamp
  times outside [0, duration].
- **Preview** (`mgr.terrainPreview` / chooser preview, zero duration): a
  fixed pose at the best drop station's best aim. It is stable and needs no
  plan.

### 9.4 Stops

During a `stop` span: decelerate to `ω_min` over 0.5 s, freeze the aim
target, and resume on the next onset. The speed integral is re-solved so the
next hero time still holds.

### 9.5 Re-planning when analysis improves

`BiomeManager` can replace the section list mid-song (`refineChapterPlan`,
late lyric fusion). On replacement:
`plan = replan(previousPlan, newSections, committedThroughMs)`.
1. Keep every keyframe at or before `committedThroughMs + 3 s` unchanged.
2. Start the new search from that keyframe's position, road edge, velocity,
   tier and heading.
3. Re-plan only the remainder.

**Test:** a seek after a replan returns the same poses for heard time.

---

## 10. Integration into The Range

### 10.1 Mode flag

- `resolveRangeMode()` (`src/world/alpine/RangePresentation.js`) reads
  `?rangeTour=tetons` and a persisted preference `range-tour` (localStorage,
  wrapped in try/catch as elsewhere). It returns `tour: 'tetons' | null`.
- Add a **Display panel** toggle: "Range: Tetons only" (see
  `docs/pixel-presentation.md` for where Display options live). The chooser
  cards stay equal; there is no new card.
- When `tour` is set and The Range is the world: `forcedView` = the catalog
  entry `teton-range-tour` for every biome; `songTerrain.biomes = ['CONIFER']`
  so `planChapters` yields one chapter and travel seams never fire.

### 10.2 Camera-path provider (replaces direct `cameraPoseAt` calls)

Add to `src/world/terrain/SceneTravel.js`:
```js
export function scenePoseAt(view, { progress01, timeMs, tour }) // tour ? tour.poseAt(timeMs) : cameraPoseAt(view, progress01)
export function pathStations(view, count, tour)                 // poses for review/bake/forest; rail stations when no tour
```
Switch every call site to them. The current list is:
`RangePresentation.js:530`, `RangeScene.js:728`, `RangeFrame.js:240`,
`ForestCover.js:80`, `RangeActors.js:235`, `LandscapeGiants.js:84`,
`src/dev/range-scene-review.html:83`. Re-grep before you start; the list may
have grown. `cameraRailErrors` validation is skipped for tour views and
replaced by `tourPackageErrors` (Task 7).

### 10.3 Camera moves off

`applyCameraMoves` (`RangeCamera.js`) returns the pose unchanged in tour mode.
That covers both `rangeCameraMoveAt` and `RangeUserCamera`; ignore wheel and
pinch input. The camera is always on the highway.

### 10.4 Terrain level of detail by route window

The current mesh is one static geometry with a baked stride per tile
(`TerrainMesh.tileStrides`, `buildTerrainGeometry`). For the tour:
- Split the song into **8 s windows** of heard time. For each window, take
  the eye positions at 2 Hz and the union of their frustums widened
  ×1.2. Give each tile the coarsest stride whose stored error, projected at
  the tile's minimum view depth (`viewDepthToBox`) over the window, is ≤ the
  budget's pixel error (desktop 1 px, mobile 2 px, the same as now).
- Build window geometry **ahead of time** (2 windows ahead) off the main
  thread; reuse the existing tile worker (`src/engine` is Ridgeview's; for
  Midio, find the Range v2 build worker or create
  `src/world/alpine/terrainWindowWorker.js`). Swap at the window boundary.
  Edge snapping between neighbouring strides works as it does today ("finer
  edges snap to the coarser neighbour").
- Popping is bounded by the pixel budget. Verify on the evidence render that
  no pop is visible at 1080p.
- **Residency:** register window geometries in the shared ledger
  (`GraphicsResidency`); at most 3 windows resident (previous, current, next).
- **Seek:** build the target window synchronously at low detail (stride
  doubled), then refine.

### 10.5 Deformation near the eye

The Range lifts and moves ridges with the music, by up to 180 m
(`calibrateRangeMusic` in `RangeFrame.js`). In tour mode, multiply
deformation by `smoothstep(1500, 4000, distance from eye)` (new uniform
`uDeformNearFadeM` in `TerrainMaterial`/`RangeScene`; use the same factor in
the depth pass and in `ForestGL` so trees stay rooted). The far field keeps
its musical motion and the camera never meets a moving ridge.

### 10.6 Sky that stays fixed when the camera turns

`skyTurn(pose, refForward)` (`RangeSkyComposition.js`) assumes the camera
stays close to the rail's direction, and returns `{0, 0}` when the reference
direction is behind the camera. In tour mode:
- choose a world sun azimuth for the song (from `resolveCelestialState`'s
  time of day, mapped so that golden hour lights the east face: sun azimuth
  ~250° in the evening, ~100° in the morning);
- lay the canvas sky (clouds, aurora, stars) out on a 360° heading cylinder,
  and draw only the part inside the current horizontal fov;
- the sun and moon draw only when they are in front of the camera; the
  terrain light direction uses the same world azimuth. Check how
  `RangeScene` gets its light direction now; if it derives it from a
  screen-space light position, convert it to world space for tour mode.
- **Test:** with yaw +170°, the sun's screen x moves by the projected amount
  (or the sun leaves the frame); it never stays in place.

### 10.7 Valley mist

`CloudSea` raises a mist layer in quiet passages. Quiet passages are also
when the camera flies low. In tour mode, cap the mist top at
`eyeY − 120 m` along the route window. If the cap falls under the mist's
minimum visible thickness, the mist simply does not rise for that stretch.
Do not lift the camera to clear the mist (the altitude belongs to the
music).

### 10.8 Forest

`ForestCover` places trees around rail poses. Use `pathStations` with the
window's poses and rebuild instances per window, the same way as the terrain
windows. Keep the 13 m lattice and quality subsets unchanged.

### 10.9 Debug and review

- `?tourDiag=1` (only with `?dev=1`): a corner overlay with section role,
  active point name and id, tier and AGL, ω and v, chosen-aim quality against
  the best available, and the last `plan.notes[]` entry.
- `src/dev/teton-tour-review.html`: a top-down map (a canvas hillshade from
  the tour package) showing the highway (spine thicker), stations coloured by
  role (primary filled, backup hollow), the planned route for a loaded
  section list, and a time scrubber that shows `poseAt(t)` as a frustum.

---

## 11. Asset formats

**`src/assets/range/v2/tour/teton-range-tour.tour.json`** (schema `midio.tour`, version 1):
```
{ schema, version, id, terrainViewId: "teton-range-tour", horizontalCrs, axes,
  roles: [11 names], fallback: {role: [..]},
  points: [{ id, name, type, role, tier, localM:[x,y,z], lonLat, elevationM,
             prominenceM, isolationM, grandeur, suit: {role: 0..1},
             station: { nodeId, posM:[x,z], yM, passHeadingDeg, ringM, offsetM } }],
  nodes:  [{ id, posM:[x,z], pointId|null }],
  edges:  [{ id, a, b, kind: "road"|"orbit", spine: bool, lengthM,
             samples: { offset, count } }],
  field:  { spacingM: 100, tiers: [0,120,300,600,1000], headingStepDeg: 5,
            layout: "see §6.3", offsets },
  clearance: { cellM: 60, width, height, originM, offsets },
  payload: { url, sha256, byteLength, decodedSha256 },
  tunables: { ...§12 values actually used },
  provenance: { demSha256, namesSha256, builtWith } }
```
**`.tour.bin.gz`:** road samples (`Float32` x, z, floorY, ceilY every 25 m),
the field (§6.3) and clearance grids.

**Catalog:** a new entry `teton-range-tour` in `data/terrain/scenic-views.json`
and `src/world/terrain/sceneCatalogData.js` with `tourManifestUrl` and
`tourManifestSha256` added to the approval hashes
(`tools/build-range-scene.mjs approvalHashes`). Status `candidate` until the
evidence in §13 is reviewed by the user. A candidate is still usable through
the mode flag (forced views allow candidates).

---

## 12. Tunables (defaults; record changes in the progress doc)

| Name | Default | Section |
| --- | --- | --- |
| `P_MIN` (minimum prominence) | 15 m | 2.1 |
| `ISO_MIN` | 120 m | 2.1 |
| primaries per role | 4 | 3.4 |
| backups per role (max) | 14 | 3.4 |
| same-role primary spacing | 2.5 km (drop 1.5 km) | 3.4 |
| `R_min` (turn radius) | 400 m | 5.2 |
| spanner stretch | 1.35 | 5.2 |
| field spacing | 100 m | 6.1 |
| AGL tiers | 0/120/300/600/1000 m | 6.1 |
| `ω_min` / `ω_max` | 0.03 / 0.30 per s | 8.1 |
| `T_dwellMax` | 22 s | 8.4 |
| yaw rate | 25°/s (12°/s calm or reduced motion) | 9.1 |
| climb rate | 30 m/s | 9.1 |
| deformation near fade | 1.5 → 4 km | 10.5 |
| LOD window | 8 s | 10.4 |

---

## Tasks

### Task 0: Baseline and reading
**Files:** `docs/teton-tour-progress.md` (new).
- [ ] `npm ci`, `npm test`, `npm run lint`, `npm run stage:site`; record the counts in the progress doc.
- [ ] Read: `src/world/terrain/SceneTravel.js`, `src/world/alpine/RangePresentation.js`, `RangeScene.js` (camera, deformation, light), `RangeFrame.js`, `RangeCamera.js`, `TerrainMesh.js`, `TerrainPackage.js`, `ForestCover.js`, `CloudSea.js`, `RangeSkyComposition.js`, `src/world/BiomeManager.js` (sections, `refineChapterPlan`), `src/world/ChapterPlanner.js`, `tools/build-range-scene.mjs`, `tools/lib/terrain-bake.mjs`, `docs/range-v2-progress.md`, `ridgeview/src/core/viewpoints.js`.
- [ ] Confirm or correct every file and line reference in this plan; note changes in the progress doc.

### Task 1: Whole-range DEM and terrain package
**Files:** `data/terrain/teton-tour.json`, `tools/build-teton-tour.mjs` (DEM and terrain stage), `tools/lib/terrain-bake.mjs` (new option `allTiles: true` with error tables, leaving the default path byte-identical), `src/world/alpine/TerrainPackage.js` (accept the `errors` table), `src/assets/range/v2/terrain/teton-range-tour.terrain.{json,bin.gz}`, `test/tourTerrainPackage.test.mjs`.
**Interfaces:** each tile gains `errorsM: { "1": m, "2": m, … }`. `lod` is absent for `allTiles` packages. Validation accepts either `lod` or `errorsM`.
- [ ] Write failing tests: the package validates; the summit checks of §1 pass; the existing views' packages and hashes are unchanged.
- [ ] Normalize the DEM (4 tiles), despike, and bake all tiles at stride 1 (provisional; Task 7 re-packs). Log the size.
- [ ] Commit.

### Task 2: Points and properties
**Files:** `tools/lib/tour-points.mjs`, `tools/build-tour-names.mjs`, `data/terrain/teton-tour-names.json`, `data/terrain/teton-tour-points.json`, `test/tourPoints.test.mjs`.
**Interfaces:** `findPoints(grid, { pMin, isoMin, names }) -> { points, stats }`.
- [ ] Tests on synthetic grids: a cone has 1 peak; two cones joined by a saddle give the right prominence and key col; a flat-topped peak is one peak; a peak touching the edge is marked truncated; isolation is correct on a 2-cone case.
- [ ] Run it on the Tetons. Assert that every GeoNames peak with prominence ≥ 30 m is matched; print the 20 highest with prominence and isolation.
- [ ] Add lakes, canyons and buttes; compute all §2.4 properties.
- [ ] Commit (the points file is review data, and it is fine to commit).

### Task 3: Roles and tiers
**Files:** `tools/lib/tour-roles.mjs`, `test/tourRoles.test.mjs`; the points file updated.
- [ ] Tests per §3.4 point 5, plus: suitabilities in [0, 1]; assignment is deterministic; no point holds two roles.
- [ ] Implement §3.2 and §3.4. Print a table of role → 4 primaries (name or "unnamed (lat, lon, h)") to the progress doc for user review.
- [ ] Commit.

### Task 4: Clearance field and stations
**Files:** `tools/lib/tour-stations.mjs`, `test/tourStations.test.mjs`.
- [ ] Tests: no station below the floor; flyability is ≥ 2 for every station; drop and chorus stations sit within 300–600 m of their summit.
- [ ] Implement §5.1 (floor and ceiling) and §4. Stations need view quality at a single point: expose `scoreEye()` from Task 6's module early (write Task 6.1–6.2 first, then come back).
- [ ] Commit.

### Task 5: Highway graph
**Files:** `tools/lib/tour-highway.mjs`, `test/tourHighway.test.mjs`.
- [ ] Tests on a synthetic 3-valley grid: the spine goes S→N; the graph is connected; turn radius ≥ `R_min` after smoothing; no sample below the floor; the spanner keeps stretch ≤ 1.35 for all station pairs; orbit loops exist at degree-1 nodes.
- [ ] Implement §5.2 for the Tetons. Write `docs/evidence/teton-tour/highway-stats.json` (total length, edge count, degree histogram, longest edge, min band height).
- [ ] Commit.

### Task 6: View-quality field
**Files:** `tools/lib/view-quality.mjs`, `tools/lib/view-quality-worker.mjs`, `test/viewQuality.test.mjs`, `test/fixtures/synthetic-crest-grid.mjs`.
- [ ] Port the Ridgeview scorer (credit it in a comment); add the §6.2 terms. Tests in §6.4.
- [ ] Compute the field for all samples and tiers with workers and the cache. Log the runtime and the best and worst samples.
- [ ] Commit.

### Task 7: Pack the tour asset and the final terrain
**Files:** `tools/build-teton-tour.mjs` (pack stage), `src/world/terrain/TourPackage.js` (loader + `tourPackageErrors`), `src/assets/range/v2/tour/teton-range-tour.tour.{json,bin.gz}`, the re-packed `teton-range-tour.terrain.*`, catalog updates, `test/tourPackage.test.mjs`.
- [ ] Re-pack the terrain: stride 1 within 6 km of any road sample, stride 2 elsewhere. Assert the budget: terrain ≤ 18 MB, tour data ≤ 4 MB, total `src/assets/range/v2` ≤ 60 MB.
- [ ] Loader validates the schema, hashes, offsets and finiteness, and refuses a mismatched package (the same failure style as `TerrainPackage.js`).
- [ ] Add the catalog entry (candidate); approval hashes include the tour manifest; `npm run stage:site` copies the new assets.
- [ ] Commit.

### Task 8: Section roles (runtime)
**Files:** `src/world/terrain/SectionRoles.js`, `test/sectionRoles.test.mjs`.
- [ ] Tests in §7, failing first.
- [ ] Implement. Find the lead-note source and document it in a comment.
- [ ] Commit.

### Task 9: Route planner
**Files:** `src/world/terrain/TourPlanner.js`, `src/world/terrain/TourGraph.js` (Dijkstra with fillet-aware edge costs, small binary heap), `test/tourPlanner.test.mjs`.
- [ ] Tests in §8.5, plus: occurrences 1–4 of chorus land on 4 different primaries in a 4-chorus song with normal timing; `finalChorus` takes the highest-G chorus point available; the drop prefers Grand Teton; feasibility for a 50 s song, a 10 min song and a single 4 min section.
- [ ] Implement §8. Planning time ≤ 60 ms (benchmark test with a generous CI margin; log the actual time).
- [ ] Commit.

### Task 10: Timeline and `poseAt`
**Files:** `src/world/terrain/TourTimeline.js`, `test/tourTimeline.test.mjs`.
- [ ] Tests: finite poses everywhere; clearance at 10 Hz and midpoints; yaw and climb limits; hero lock (at `tHero` the aim is within 3° of the station's best); mean chosen-aim quality ≥ 0.8 × the per-sample maximum; seek parity (random access equals sequential); replan freezes the past (§9.5); the preview pose is stable for zero duration; reduced motion halves the limits.
- [ ] Implement §9.
- [ ] Commit.

### Task 11: Range integration
**Files:** `src/world/alpine/RangePresentation.js`, `RangeScene.js`, `RangeFrame.js`, `RangeCamera.js`, `ForestCover.js`, `RangeActors.js`, `LandscapeGiants.js`, `TerrainMaterial.js`, `ForestGL.js`, `CloudSea.js`, `RangeSkyComposition.js`, `src/world/terrain/SceneTravel.js`, `src/world/BiomeManager.js` (tour hook: build the plan when sections are ready, replan on refinement), Display panel UI file(s), `src/dev/range-scene-review.html`, focused tests (`test/rangeTourMode.test.mjs`, extend `test/rangeShaderSource.test.js`).
- [ ] Tests: mode parsing (param, preference, unknown values ignored); mode off = no behavioural change (existing suites pass unchanged); `scenePoseAt` matches `cameraPoseAt` for non-tour views; camera moves are the identity in tour mode; deformation fade is 0 at the eye and 1 beyond 4 km in both the colour and depth shader sources; the sky-turn test of §10.6; the mist cap.
- [ ] Implement §10.1–10.3 and §10.5–10.8.
- [ ] Commit.

### Task 12: Windowed terrain LOD and forest
**Files:** `src/world/alpine/TerrainMesh.js` (window stride planning), new `src/world/alpine/TourTerrainWindows.js`, the worker file, residency registration, tests `test/tourTerrainWindows.test.mjs`.
- [ ] Tests: the stride choice meets the pixel budget at every 2 Hz pose in the window; at most 3 windows resident; seek builds the target window; generation-safe disposal (no leak across song replacement, resize, context loss; reuse the existing lifecycle suite pattern).
- [ ] Implement §10.4 and the forest windows (§10.8). Measure triangles per window (desktop ≤ 1.5 M, mobile ≤ 1.0 M) and record them.
- [ ] Commit.

### Task 13: Review tools, evidence, docs, PR
**Files:** `src/dev/teton-tour-review.html`, `tools/teton-tour-smoke.mjs`, `docs/evidence/teton-tour/`, `docs/teton-tour-validation.md`, `docs/teton-tour-progress.md`, `Readme.md` (one paragraph under the world list or the controls table: `?rangeTour=tetons` and the Display toggle).
- [ ] Full `npm test`, `npm run lint`, `npm run stage:site`.
- [ ] Smoke (Playwright + SwiftShader; see `tools/range-scene-smoke.mjs` for setup): with the 5 synthetic songs from `tools/gen-test-wav.mjs` used in `docs/range-v2-progress.md`, capture a frame at every hero time and at the middle of the longest section; check for no shader errors, finite poses, and that pause and re-render give identical pixels.
- [ ] Render the top-down map with the highway, roles and one song's route (`map.png`), plus a contact sheet of the 44 primary stations' hero views (`primaries.jpg`). The user reviews these to approve the roles.
- [ ] Record what could not be verified (no GPU, no phone: device performance is **unverified**, as in `range-v2-device-runs.md`).
- [ ] Open a PR describing exactly what was validated; do not merge.

---

## 13. Acceptance summary

| Check | Pass |
| --- | --- |
| Points | every GeoNames Teton peak with prominence ≥ 30 m matched; `teton-tour-points.json` lists all points with properties |
| Roles | 11 roles × 4 primaries; spacing rules hold; drop includes Grand Teton |
| Highway | one component; spine S→N; turn radius ≥ 400 m; band ≥ 150 m; no floor violations |
| View field | tests in §6.4; reproducible across worker counts |
| Planner | ω within bounds ≥ 98% of song time; long sections use backups; never off-road; ≤ 60 ms |
| Timeline | clearance, rate limits, hero lock, quality ratio ≥ 0.8, seek parity, replan freeze |
| Integration | mode off changes nothing; sky world-fixed; deformation fades near the eye; mist capped |
| LOD | pixel budget met per window; ≤ 3 windows resident; triangle caps |
| Budget | tour assets ≤ 22 MB; `src/assets/range/v2` ≤ 60 MB |

## 14. Risks and what to do about them

- **Ray-cast compute time** (Task 6). If the field takes over 2 h on 8
  cores, coarsen the ray step (`RAY_STEP_FRAC` 0.004 → 0.006) and the fan
  (1.5° → 2°) before cutting tiers. Record the change.
- **20 m DEM at close range.** Passes at 150 m from a spire will show 20 m
  facets. The existing procedural rock detail helps. If it still reads soft,
  bake the 3 km around the 8 drop/solo stations at 10 m (3DEP 1/3" is ~10 m)
  as finer tiles. This is a follow-up, not part of this plan.
- **Sky rework (§10.6)** touches shared Range code. Keep the tour branch
  behind the mode flag, and prove that the non-tour output stays the same
  with the existing evidence hashes.
- **Section analysis is approximate** (frequency bands, not instrument
  separation; see Readme "How a song becomes a performance"). The roles
  degrade gracefully: wrong roles still give a smooth, valid flight, because
  every role has points everywhere and the fallbacks are geographic
  neighbours.
- **Fast flights in short songs.** Up to 320 m/s at 1,000 m AGL is ω 0.32,
  just above `ω_max`; the planner refuses it. If short songs look frantic,
  lower `ω_max` and let more heroes be `passedAtRange`.
