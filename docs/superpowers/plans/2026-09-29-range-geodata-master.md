# Midio-5 Geodata Landscape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task if that skill is available. Use `superpowers:subagent-driven-development` only when the execution session authorizes delegation. If these skills are unavailable, execute the same checklist directly. Steps use checkbox syntax for tracking. The user does not require approval pauses between tasks, milestones, design revisions, or implementation phases.

**Target implementer:** Opus 5.5.  
**Goal:** Make The Range approach the supplied cinematic blue-hour landscape through real terrain surfaces, a smaller curated collection of compelling views, detailed materials and vegetation, and coherent live lighting, while retaining Midio's musical identity and reliable playback.  
**Architecture:** Retain two-dimensional elevation data and bake finite terrain corridors into compact, multiresolution assets. A constrained GPU scene renders those surfaces through the existing stage compositor; simulation, heard-time, ground contact, and musical skyline systems remain authoritative. Select complete scenic views rather than independently stacking three arbitrary range outlines.  
**Tech stack:** Existing JavaScript ES modules, Canvas 2D, Node test runner, Playwright; a pinned, locally bundled Three.js/WebGL2 renderer; an offline GDAL/Python raster preparation step and Node asset/catalog tooling.  
**Spec:** Sections 1–8 of this document are the normative design specification. Sections 9–13 are its executable implementation plan, verification matrix, and handoff rules. Keep this entire document together.  
**Repository:** `aepler315/Midio-5`.  
**Audited base:** `b8a3d72b344792d149906449f1cd86d68df8cc2b`; remote `main` was rechecked at this SHA while preparing this plan. Reconcile subsequent changes before editing.  
**Date:** September 29, 2026, Pacific time.

## Global constraints

- Primary mountain structure comes from retained elevation surfaces. Do not reconstruct the whole mountain from a skyline or disguise empty polygons with noise.
- Preserve Midio, Broshi, Midasus, their current hues and choreography, the restored Dancing Ridge, SpaceRidge, heard-time behavior, transport, finite source travel, opening transition, reduced-flash behavior, and world identities.
- The reference is an art-direction target. A flat copy of it, a generated concept image, or a diagnostic scene without production effects is not an implemented result.
- All visible production layers must reach the actual recording/export surface.
- Initial target is 12–18 approved scenic views covering all 11 existing Range biomes; coverage and visual merit take precedence over the numeric target. Retain the old catalog for fallback and diagnostics, not as equal-probability production scenery.
- Publish real assets and reproducible build metadata. No unresolved asset slots, remote runtime CDN imports, fabricated elevation, or relabeled upscaled source data.
- Only alpine presentation and its necessary shared integration contracts are in scope. Avoid a framework conversion, free-camera game, or unrelated application rewrite.
- Tests, image inspection, and moving evidence are implementation completion criteria. They do not introduce user approval gates.
- This document authorizes no action by itself in a different session. The accompanying execution prompt supplies the implementation request; honor the permissions actually available there.

## Review focus

1. **A cold or interrupted load:** a late asset response must not replace the current song/world, and playback must remain usable. Owned by Tasks 7, 16.
2. **Backward seeking, pause, and repeated drawing:** terrain, vegetation, reflection, and simulation state must agree at the same heard-time. Owned by Tasks 1, 6, 10, 12.
3. **Small catalogs and sparse biomes:** selection must not invent unsuitable ecology, reopen rejected views, or silently create missing procedural ridges. Owned by Tasks 5, 15.
4. **Portrait, zoom, shake, and resolution changes:** character contact and foreground placement must remain correct while scenery reframes. Owned by Tasks 8, 11, 14.
5. **Transitions near the resource limit:** both sides and temporary resources must fit a real reservation, remain visible, and release correctly. Owned by Tasks 7, 14, 16.

---

## 1. What this plan supersedes and what is already known

The prior audit recommended an asset-assisted GPU 2.5D renderer and identified a set of correctness and integration defects. The user's subsequent direction improves the terrain source: retain real elevation around ridges, including spurs and valleys, and invest in fewer better views. This plan makes that the primary route. Authored art supplies surface detail, vegetation, near-stage geometry, and bounded artistic additions; it does not replace available measured large-scale terrain.

This plan supersedes the old Canvas-only reference plan and the audit's suggestion to begin with manually invented mountain faces. It also replaces the assumption that every scenic scene needs three unrelated real ranges. The old audit remains supporting evidence, not a conflicting implementation specification.

### Verified baseline

| Evidence | Result at the audited SHA |
| --- | --- |
| Repository validation | 3,228 tests passed; lint and site staging passed. These are historical baseline results, not results for this implementation. |
| Runtime range data | 83 generated range modules, each exporting an L2 skyline. The full elevation surface is not shipped. |
| Source builder | `tools/build-ranges.mjs` fetches Terrarium elevation, uses zoom 12 with a zoom-11 tile-count fallback, and resamples at 30 m. Source resolution and output spacing are separate facts. |
| Projection | `SkylineScan.js` makes a moving, side-on scan. Horizontal coordinates represent distance along the scan, not a conventional camera photograph. |
| Range selection | `RangeMatcher.js` sets `FAIR_SHARE = 0.65`. `BiomeSet.js` also imports it for the home-biome draw. Changing that constant affects more than scenic selection. |
| Foreground filter | `ranges/shapes.js` flags high flat windows; the current filter primarily protects the foreground. It is not a scenery-quality review. |
| Renderer | The optional `WebGLRenderer.js` is a Canvas wrapper plus sibling tint/vignette overlay, not a terrain engine. |
| Recording | `src/render/SongRecorder.js` and `tools/bulk-export.mjs` sample the main stage canvas. |
| Confirmed defects | Fixture quality 6 is reset to 0 by `holdQuality`; Broshi draw consumes simulation RNG; wet response clips to rectangles; pinned strip allocations can exceed the nominal budget. |
| Existing pictures | Two genuine controlled RAINFOREST captures at 1280×720, DPR 1, quality 0. They show current output, not the new design. |

Read `support/midio-5-visual-audit.md` and inspect the reference and both current captures before coding. Do not rerun the entire audit merely to rediscover these findings. Verify the relevant source when a task touches it.

### Current files to read first

- Data: `tools/fetch-terrain-grid.mjs`, `tools/build-ranges.mjs`, `tools/build-terrain-profile.mjs`, `tools/lib/terrarium.mjs`, `src/world/terrain/LatLonDem.js`, `SkylineScan.js`, `TerrainProfile.js`.
- Selection/travel: `src/world/terrain/RangeLibrary.js`, `RangeMatcher.js`, `BiomeSet.js`, `ProfileTravel.js`, `RangeHistory.js`, `src/world/RealBiomes.js`.
- Rendering: `src/render/Renderer.js`, `WebGLRenderer.js`, `PerfGovernor.js`, `src/world/BiomeManager.js`, `src/world/WorldRegistry.js`, `src/world/alpine/RidgeComposition.js`, `GroundMaterial.js`, `GroundResponse.js`, `ValleyAtmosphere.js`.
- Delivery/evidence: `tools/serve.js`, `tools/stage-site.mjs`, `tools/lib/landscape-browser.mjs`, `landscape-fixtures.mjs`, `landscape-evidence.mjs`, `tools/range-landscape-smoke.mjs`, `src/render/SongRecorder.js`, `tools/bulk-export.mjs`.

## 2. The visual specification

The supplied reference is 1806×871, approximately 2.073:1. Inspect the original pixels. It depicts an alpine valley at blue hour with conifer forest, snow, cliffs, waterfalls, valley mist, wet foreground rock, and two luminous wireframe subjects. It is detailed cinematic stylized realism.

### Composition and form

- Large asymmetric side masses frame a deep central opening. The tallest snowy mass is on the right; wooded cliffs descend from the left.
- Mountain surfaces contain connected flanks, branching spurs, gullies, shelves, and selective snow. The internal relief is as important as the silhouette.
- Forest reads at three scales: identifiable nearby crowns, broken middle-distance stands, and remote canopy texture. Placement follows terrain and habitat.
- The central performer footing sits around 80–90% of image height, with visible rock top planes continuing to the lower edge. Adapt framing at other aspect ratios rather than stretching it.
- The cyan subject occupies roughly 34–47% of width and 65–89% of height; the rose subject is smaller and to the right. Preserve the real app's cast and color identities rather than imposing those literal coordinates or rose on every companion.
- The moon is a secondary object near 12% of width and 22% of height, about 3.5% of width across. Clouds partly cross it. A giant blank disc must not dominate the scene.

### Light, atmosphere, and material

- Dark crisp rock and trees remain legible against distant, lower-contrast slopes.
- Mist collects between landforms and is occluded by closer objects. It must not erase the entire mountain face.
- Emitters have sharp near-white cores, colored margins, and compact halos. Illumination changes locally with current pose, position, and hue.
- Water reflects the live performer shape, broken by roughness, ripples, and rock occlusion. It is distinguishable from damp stone and moss.
- Snow follows altitude, slope, exposure, and channels as art-directed terrain masks. It must not look like identical triangular caps on every summit.
- The reference's median linear luminance is about 0.052 under an sRGB assumption; less than 1% of pixels exceed 0.5. Use this as a useful contrast observation, not a universal numeric grading target.

### Music and motion

The reference is a still, so its motion is a design decision. Keep fast response in performers and musical signatures; use slower mist, wind, and water. Existing musical terrain movement must carry its materials and rooted vegetation coherently. Calm and energetic states must both be shown. Do not dim or delete Dancing Ridge/SpaceRidge to make the calm reference comparison easier.

All foreground materials must follow the rendered support curve from `GroundField.visibleBars()`, including deliberate visual ripple/groove/quake movement. Preserve physical `heightAt()` and existing landing behavior; first record their current relationship rather than silently changing physics to make a screenshot align.

## 3. Terrain source and asset pipeline

### 3.1 Preserve the surface

Build each view from a bounded elevation raster covering its camera path and visible terrain, with an explicit guard margin for framing and streaming. Preserve main crests, secondary spurs, valley walls, and drainage depressions in one connected surface. A ridge-branch extraction algorithm is optional; branch polylines are not required to render the heightfield.

The source path is:

1. Select candidate region and actual view corridor.
2. Acquire documented elevation tiles; retain source files/checksums outside the runtime tree.
3. Normalize into a local metric coordinate system, preserving the reversible transform to geographic coordinates.
4. Build terrain mesh levels, normals, material masks, depth partitions, and source landmarks.
5. Bake the approved view manifest and compact runtime assets under `/src/assets/range/v2/`.
6. Load only the active view, the next required transition view, and bounded adjacent tiles.

### 3.2 Source choice and truthfulness

Use existing Terrarium data to prove the pipeline quickly and for sufficiently distant terrain. For the primary mountain face, target approximately 10 m source data; investigate 1 m products for selected close areas where available and worthwhile. USGS 3DEP is a suitable U.S. source. Canadian/Mexican candidates require their own verified coverage and provenance; do not assume U.S. products cover them at the same resolution.

These spacings are starting source-selection targets, not guaranteed visible quality. Determine the actual need from camera distance, projected size, slope, and simplification error. Never label a 30 m source resampled to 1 m as measured 1 m terrain. A bare-earth raster also does not provide trees, rock color, moss, or overhang geometry.

For imported GeoTIFFs, use GDAL for reprojection, alignment, cropping and explicit no-data handling. Record source and destination horizontal/vertical references and units. Preserve the raw source's metadata; do not combine incompatible height datums without an explicit conversion. Do not turn no-data into sea-level walls.

The old rotation helper rewrites a geographic-looking bounding box for a range-aligned grid. New geometry must retain the actual coordinate transform. Never infer real coordinates from that rewritten box as though it were still north-up. Prefer unrotated source data plus an explicit local transform for new assets.

### 3.3 Runtime representation

Use a documented binary mesh package: typed-array position, normal, UV, index, and optional material-mask buffers, referenced by a JSON manifest. Prefer a small explicit format over a custom general-purpose scene format. Use little-endian Float32 attributes and Uint16/Uint32 indices with declared byte offsets, counts, bounds, and SHA-256 values. Validate offsets, lengths, types, finite values, index bounds, and required fields before constructing GPU objects.

Geometry can be terrain tiles with shared boundary samples and multiple simplification levels. Preserve prominent crest/gully features and stitch neighboring levels without cracks. Detail levels must share geographic identity. Geometry simplification must be assessed under the real camera: initial maximum projected deviation is 1 pixel at the desktop target and 2 pixels at the mobile target for prominent terrain; if this is too costly, adjust subdivision/streaming before weakening the silhouette.

Raw national rasters do not belong in runtime downloads. Store source manifests and build recipes in git; store heavy source caches outside git. Runtime assets must actually be delivered through the deployment path, not merely through Git LFS pointer files that the static host cannot resolve.

### 3.4 Materials and art production

The first pack must contain actual usable assets:

| Group | Required production information |
| --- | --- |
| Rock | Coherent albedo, normal/detail normal, roughness, medium-scale fracture/material masks; avoid baked neon or fixed global fog. |
| Snow/soil | Coverage masks attached to the terrain, blend transitions, plausible accumulation/erosion variation. |
| Forest | Several irregular conifer individuals/clusters, near trunks/crowns, distant canopy treatment, alpha-edge-safe mipmaps. |
| Foreground | Connected rock top planes, broken edges, soil/moss crevices, shallow basin geometry and exact wet masks. |
| Sky/mist | Cloud structure, lunar texture, irregular mist density; keep them separate from terrain color. |

Use licensed source assets, authored bakes, or generated components when suitable tools are available. Record provenance and licenses for every external asset. Generated art must be cleaned and converted into usable components; a generated full scene with baked performers is not a material pack. If an essential asset cannot be obtained, report the exact blocker and continue independent work; do not quietly substitute toy geometry and mark the visual requirement complete.

Use 2K–4K authoring masters where projected size justifies them, then build appropriate runtime tiles/mips. Color maps need the correct color-space annotation; normals, roughness and masks are data. Keep the working-light calculation and final output conversion consistent. Introduce GPU texture compression only with a supported local decoder/transcoder path, measured savings, and a working fallback.

## 4. Curate views, not merely range names

### 4.1 Catalog structure

The new catalog contains **scenic views**: a region, one complete terrain corridor, an approved finite camera path, its compatible biome, material pack, terrain bounds, and evidence. A single corridor supplies its real front-to-back mountain structure. It does not need three separately chosen ranges to pretend to have depth.

Initial target: 12–18 approved views. This is a concentration-of-effort target, not permission to remove biomes or include weak scenery to hit a count. All 11 existing biomes must have at least one approved production view before full rollout: ICEFIELD, TUNDRA, TAIGA, RAINFOREST, CONIFER, PINE_OAK, BROADLEAF, CHAPARRAL, STEPPE, CANYON, DESERT. Add a few strong views if coverage demands it and document why.

Keep the original 83-range source library for diagnostics, fallback, and the independently managed musical skyline pool. Do not delete its provenance/history data. The new scenic renderer must not fall back to equal-probability selection from unapproved views.

### 4.2 Candidate review

Start the reference pilot with candidate corridors in North Cascades and Skagit Range. They already belong to the relevant biome, but neither is pre-approved as a final view. Explore both sides where meaningful, several reasonable eye elevations and distances, and useful contiguous path segments. Review actual shaded DEM surfaces before committing to a crop. Reject bad source coverage or unhelpful geometry; use another documented corridor if needed.

For wider coverage, inspect the existing catalog's biome assignments and select candidates from it. Tetons, Sawtooth, Selkirks and similar recognizable places are candidates for their actual compatible biomes, not automatic winners. The existing classification is a majority sample over a broad bounding box, so a narrower selected corridor may need classification verification. Record the evidence for any correction rather than silently changing ecology.

Create a contact sheet per candidate showing at least five path positions, a neutral-light surface view, a silhouette, and a depth view. Final acceptance uses 21 path stations and motion. Score automatic measurements as diagnostics; use recorded visual judgments for final approval.

Each approved view must pass:

- Distinct readable macro form and useful foreground/background overlap.
- Sustained internal relief or a deliberately characteristic landform appropriate to its biome.
- A clear performer stage and sightline for the musical signatures.
- No extended high flat wall through the selected travel interval.
- No isolated spectacular first frame followed by a long uninteresting traverse.
- Real visual difference from the other selected views.

Low relief is not automatically poor composition: canyons, layered desert rock and broadleaf valleys should retain their identities. Do not turn every biome into sharp alpine peaks.

### 4.3 Selection policy

Add a separate scenic-view selector. Eligibility requires `status: 'approved'`, compatible biome, valid terrain/material manifests, and the required viewport coverage. Apply music matching and repeat avoidance only inside that pool.

Use the existing four musical character axes for matching. Initial scenic lottery policy: 15% equal-share diversity plus 85% character preference among eligible views, followed by normalization. Keep stable seed hashing, deterministic order, and a catalog version. This is a deliberate starting policy for the new pool; tune only from distribution and visual evidence.

Do not globally change `FAIR_SHARE` to achieve this. The home-biome lottery also uses it, and its behavior is a separate concern. Split the policy names so scenic tuning cannot silently alter biome distribution or the musical skyline selector.

Avoid recent views/regions when a compatible alternative exists. If all eligible views are recent, relax recency within the approved set. If only one compatible view exists, use it; never satisfy diversity by selecting an unapproved or wrong-biome view. If no new view is available, use the explicit legacy fallback for that biome during migration and record the fallback reason.

Retain five-biome song selection and section-label consistency. A later analysis update must not replace the opening view midway through the opening. A returning chorus should return to its assigned scene. Store scene assignments once per song generation, rather than redrawing a lottery every frame or every section transition.

`sceneByBiome` contains lightweight assignments, not five eagerly prepared GPU scenes. Do not attach full scene preparation to the legacy `whenAll` promise. Preparation follows the active/next-view residency policy.

## 5. Projection, travel, and musical deformation

### 5.1 Choose a real constrained camera

Use a conventional perspective camera looking across the retained local terrain. Start with a straight, finite camera rail per approved view: interpolate eye and target between explicitly authored endpoints, maintain world-up, and use a fixed vertical field of view for that view. This is a constrained presentation camera, not interactive free flight. Curated framing chooses the field of view and distance; begin comparisons around 35 degrees vertical, then record the chosen value in the view manifest.

The old pushbroom skyline cannot be interpreted as this camera's screen coordinates. Keep it as a historical reference/provenance aid. Bake new silhouette/depth evidence from the actual new camera. Verify real landmarks and elevations against the source; do not force the new terrain to match an incompatible old projection by warping its peaks.

All connected pieces of a corridor share one camera, source transform, and travel position. Depth grouping for interleaving passes does not grant independent scrolling to adjoining pieces. Independently sourced distant scenery may have a separate transform only when it is genuinely a separate scene element and the transition remains coherent.

### 5.2 Reuse finite music-driven travel

Create `sceneProgressAt()` as a pure adapter over `ProfileTravel.js`, not a new accumulator. Use a canonical logical strip width of 8192 and a fixed logical reference window of 1280 for this adapter; fit with depth/maxDepth 1 and room 6912. Convert the resulting finite scroll to `u = clamp(scrollPx / 6912, 0, 1)`. Use heard-time seconds, the song's energy curves, duration, response and reduced-flash state. A zero/unknown-duration preview uses the documented midpoint preview behavior.

This gives a stable time-to-path mapping while preserving the existing music-dependent start/rate/finite-fit semantics. Screen resize and quality changes must not change the camera's geographical progress. Aspect-ratio framing is a separate projection adjustment. Camera endpoints already account for visible terrain extent and overscan, so the camera cannot leave valid data at `u = 0` or `u = 1`.

The existing Dancing Ridge's own scrolling behavior remains separate and keeps its current restored character. Do not apply the scenic path's slower travel to it.

### 5.3 Surface attachment

Use stable local metric coordinates for terrain, normals, masks, and vegetation IDs. Derive musical displacement from the existing Range envelopes as a bounded deterministic field, evaluated at the same source coordinates for mesh vertices and rooted objects. Recompute or correctly transform shading normals for the deformation. Keep macro geology recognizable and avoid full-scene rubber-sheet motion.

Pause must stop time-driven environmental motion. Seek must reconstruct the same phase from heard-time and seed. LOD changes may alter approximation detail but not the underlying mountain, vegetation distribution, or path. The opening's intentionally coarse 8-bit treatment is an explicit timed presentation state, not a permanent low-detail shortcut.

## 6. Renderer and compositor contract

### 6.1 Default integration

Keep the main stage canvas as the authoritative completed frame. Use one reusable WebGL2 renderer owned by `RangeScene`, drawing transparent scene partitions to its canvas and synchronously compositing them into the main Canvas at the existing pass boundaries. Begin with this bounded integration to preserve the current cast, transport and export code.

Do not initialize a second context on the existing 2D canvas or place the real terrain only in a DOM sibling. Use one GPU context with reusable targets, not one context per layer. Measure GPU-to-Canvas transfer cost early. Avoid per-frame `readPixels()`, texture decode, shader compilation, and unbounded temporary canvases. Copy each rendered partition before reusing its drawing buffer.

### 6.2 Pass order

Extract a small Range presentation adapter from the alpine fall-through. Retain the meaningful production order:

| Position | Content and ownership |
| --- | --- |
| Scenic background | Existing sky, celestial systems, SpaceRidge and Dancing Ridge in their current intended order. |
| Far terrain | GPU terrain far partition and its attached atmosphere/vegetation. Preserve intended occlusion of skyline effects. |
| Middle events | Existing distant vignettes and middle-depth production content at the corresponding boundary. |
| Middle/near terrain | Remaining GPU terrain partitions, with shared geometry coordinates; integrate weather/motes at the correct depth. |
| Fixed-ground switch | Apply the existing ground transform; draw the rock stage and water receivers. |
| Cast/events | Preserve obstacles, shadows, afterimages, Broshi, Midio, Midasus and their existing local ordering. |
| Water response | Draw reflected performer layers and local response through exact wet masks. |
| Near occlusion | Foreground rocks/foliage, then existing screen-level effects. |
| Final output | Existing opening capture, film finish, vignette, HUD/captions as applicable; recording sees the completed main surface. |

Do not indiscriminately replace `BiomeManager.draw()` with one opaque scene draw. Preserve interleaved events and verify each retained signature. Update `WorldRegistry` contract tests only for intentional Range integration; do not open its allowlist to arbitrary manager internals.

Make pass ownership explicit: v2 replaces the corresponding old scenic face, forest, ground-material and wet-response painters rather than drawing on top of them. Retain the separate musical skyline passes. Avoid double-painted terrain, doubled generic reflections or additive ground glow. Non-Range worlds continue to use their existing painters. Legacy strip textures must be prepared lazily for an actual fallback need, not automatically allocated behind every active v2 scene.

Partition terrain by fixed source-space depth ownership, with shared boundaries and deterministic occlusion. Never render the same transparent tree/fog contribution into two partitions. Atmosphere and sky tint must be applied once. Scenic zoom and fixed-ground transforms are distinct; GPU copies must use the intended transform exactly once.

The ground and foreground partitions use a dedicated fixed-ground projection: an orthographic stage camera calibrated to the existing logical ground coordinates, with shallow decorative depth. They must not reuse the distant scenery's moving perspective camera. Test projected contact anchors against `groundBars` before adding rock detail. The returned partition image is composed under the matching Canvas transform once, with explicit logical versus backing dimensions.

### 6.3 Performer capture and reflections

Fix render-time randomness first. For the new alpine path, render each eligible performer body into a reusable tight transparent canvas once per frame, then composite that same body in its original position in the cast order and reuse it for reflection. Keep afterimages, contact shadows, shocks and unrelated world effects in their intended passes.

Each body layer carries logical bounds, actual hue, visibility, contact height, airborne height, and frame ID. Account for glow padding and negative/offscreen bounds. Exclude characters that are buried, hidden, or in a distant voyage from near-water reflection as appropriate. Preserve each character's transform and light inputs.

Reflection is receiver-local: project the body onto the shallow water plane, foreshorten it, apply restrained distortion/roughness attenuation, clip to the exact wet polygon and rock occlusion mask, and retain correct hue and pose. The first version need not reflect the entire world. It must reflect the actual visible performer shape. Pulse/ripple events remain distinct from the reflection.

### 6.4 Copy-cost contingency

If the integrated proof shows that repeated GPU-to-2D copies are the dominant cost preventing target frame times, first reduce redundant partitions and resolution of optional passes without destroying composition. If that remains insufficient, write a short measured architecture decision and move final composition to a GPU-owned completed surface through a narrow renderer/export adapter. Preserve the same pass ordering and export contract, and rerun the same visual/export tests. Do not build both compositor strategies in advance. This is a decision rule, not an approval pause or permission for an unrelated rewrite.

## 7. Interfaces, resources, and lifecycle

The following are proposed interfaces, not existing exports. Use JSDoc types in the existing JS project. Exact field names below are shared contracts between tasks. Extend them only with a documented consumer need.

### 7.1 Offline and catalog types

```ts
type Vec3 = [number, number, number]; // local scene X east, Y up, Z south
type DemGrid = {
  width: number; height: number; cellSizeM: number;
  heightsM: Float32Array; valid: Uint8Array;
  sourceToLocal: number[]; localToSource: number[];
  horizontalCrs: string; verticalReference: string;
  sourceResolutionM: number; outputSpacingM: number;
  provenance: { provider: string; product: string; urls: string[];
    tileIds: string[]; sha256: string[]; license: string; retrievedAt: string };
};
type SceneView = {
  id: string; regionId: string; biome: string;
  status: 'candidate' | 'approved' | 'rejected';
  catalogVersion: number;
  terrainManifestUrl: string; materialManifestUrl: string;
  camera: { eyeStartM: Vec3; eyeEndM: Vec3;
    targetStartM: Vec3; targetEndM: Vec3; fovYDeg: number };
  characterScores: { energy: number; rawness: number;
    grandeur: number; dominance: number };
  evidence: { reviewPath: string; sourceHashes: string[] };
};
type SceneChoice = { view: SceneView | null; fallbackReason: string | null };
```

`DemGrid` is an offline in-memory contract. Serialize its arrays as a binary payload plus JSON metadata; do not put giant typed-array JSON into runtime source modules. Metric scene axes use right-handed X-east/Y-up/Z-south; test orientation with labeled points so northern terrain is not mirrored.

```ts
normalizeDem(inputPath, options): Promise<DemGrid>
bakeTerrain(grid: DemGrid, view: SceneView, options): Promise<TerrainManifest>
validateTerrainManifest(manifest, byteLengths): ValidationResult
chooseSceneForBiome(biome, profile, seed,
  { views, recentViewIds, recentRegionIds, catalogVersion }): SceneChoice
sceneProgressAt({ timeMs, curves, durationMs, reducedFlash, response }): number
cameraPoseAt(view: SceneView, progress01: number): CameraPose
```

`TerrainManifest` is a versioned JSON object containing view/source IDs, provenance, local bounds, mesh tile descriptors, shared-edge IDs, LOD errors, attribute buffer descriptors, asset URLs/hashes, and estimated ownership bytes. `ValidationResult` is `{ ok: boolean, errors: string[] }`. `CameraPose` is `{ eyeM: Vec3, targetM: Vec3, fovYDeg: number }`.

`normalizeDem()` is exported by `tools/lib/terrain-source.mjs`; it invokes the Python normalizer and decodes its metadata/binary output. `bakeTerrain()` and `validateTerrainManifest()` live in `tools/lib/terrain-bake.mjs`, with runtime-safe validation factored into `src/world/alpine/RangeAssets.js` when that consumer is added. `cameraPoseAt()` and `sceneProgressAt()` live in `SceneTravel.js`.

### 7.2 Runtime snapshot and rendering

```ts
type RangeFrame = {
  frameId: number; generation: number; timeMs: number; seed: number;
  biomeFrom: string; biomeTo: string; transition01: number;
  viewFromId: string | null; viewToId: string | null;
  progress01: number; qualityLevel: number; reducedFlash: boolean;
  scenicViewport: ViewportState; groundViewport: ViewportState;
  light: RangeLightState; music: RangeMusicState;
  groundBars: GroundBar[]; emitters: EmitterState[];
};
class RangeScene {
  prepare(view: SceneView, { signal, generation }): Promise<PreparedView>;
  renderPartition(frame: RangeFrame,
    pass: 'far' | 'mid' | 'near' | 'ground' | 'foreground'): CanvasImageSource;
  resize({ widthPx, heightPx, pixelRatio }): void;
  dispose(): void;
}
class GraphicsResidency {
  reserve({ key, bytes, owner, generation }): Reservation | null;
  commit(reservation, resource, dispose): void;
  pin(keys: string[]): void;
  release(key: string): void;
  cancelGeneration(generation: number): void;
  snapshot(): ResidencySnapshot;
}
capturePerformerLayers(frame, drawCallbacks): PerformerLayer[]
drawWetReflections(ctx, { frame, layers, receivers, occlusion }): void
buildRangeFrame({ frameId, generation, sim, pose, scenicViewport,
  groundViewport, sceneAssignments }): RangeFrame
```

`ViewportState` contains logical dimensions, backing dimensions, overscan, and the six-number Canvas affine transform. `RangeLightState` contains the resolved light directions/colors and local emitter colors/intensities in the explicitly named coordinate space. `RangeMusicState` contains sampled existing envelopes needed by terrain/forest/water; it does not hold the simulation object. `GroundBar` adapts the current `visibleBars()` output. `EmitterState` records ID, logical bounds/position, hue, visible status and support/airborne height. Define these adapters by tracing the current consumers; no renderer may reach back into mutable simulation state to fill omitted values.

`PreparedView` owns loaded scene assets for one view and generation. A reservation is pending owned bytes; commit converts it to live ownership without counting it twice. `ResidencySnapshot` exposes pending/live bytes by owner, pinned keys, and cancelled generations. `PerformerLayer` contains ID, canvas, logical bounds, current hue, frame ID, visibility and contact/airborne metadata. Pooling must not let a returned layer be overwritten before its body/reflection consumers finish.

`RangeFrame` is logically immutable for the frame. Reuse stable storage for hot-path performance but do not allow asynchronous work to mutate a published frame. If A/B scenes require different view-local progress, store that explicitly in an extended side record; never reuse one view's local coordinates for another.

`buildRangeFrame()` is the only new presentation adapter permitted to read the simulation to assemble this snapshot. It lives in `RangeFrame.js`. In `resize()`, `widthPx` and `heightPx` are physical backing dimensions; `pixelRatio` is evidence/LOD context and must not multiply those dimensions a second time.

### 7.3 Resource limits and delivery

Initial engineering budgets, to be validated rather than sold as universal device limits:

| Budget | Desktop target | Mobile target |
| --- | --- | --- |
| Presentation | 1920×1080 at 60 fps | 1280×720 at 30 fps minimum; pursue 60 when measured sustainable |
| Tracked graphics ownership | 256 MiB | 128 MiB |
| Steady-state frame interval goal | p95 ≤20 ms | p95 ≤40 ms |
| Normal non-transition hitch | No recurring >100 ms stalls | No recurring >100 ms stalls |

Count decoded CPU images, GPU textures including mips, mesh buffers, pending decodes/uploads, offscreen canvases, render targets, performer buffers, and both A/B sides. Report this as an ownership estimate, not browser process RAM or exact GPU residency. Browser/driver overhead still needs device observation. The old 176 MiB strip counter is not a separate unlimited allowance; active fallback resources share the new accounting and migration must release unused legacy strips.

For scale: one 1920×1080 RGBA8 image is 7.91 MiB; a 4096² RGBA8 texture is 64 MiB before mips, approximately 85.33 MiB with a full mip chain. Download compression does not determine decoded residency.

Reserve before creating or decoding resources. A denied reservation must trigger reuse, lower optional detail, delayed prefetch, or explicit fallback. Never allocate anyway. Pin the current frame and scheduled transition needs. Bound pending jobs and cancel obsolete generations. Release every resource through one documented owner.

Keep runtime assets and bundled dependencies under `/src`, which the existing server and staging copy. Use `src/assets/range/v2/` for terrain/art and `src/vendor/range/` for generated dependency/decoder output. Add a narrow reproducible dependency-bundle script and lock its npm versions. Run it as part of staging; preserve license notices. Do not require a runtime build server or redesign the whole application around a new bundler.

### 7.4 Failure behavior

WebGL2 unavailable, context loss, asset 404, invalid manifest, decoder failure, insufficient reservation, or stale generation must take an explicit tested path. Keep the approved cast and music running through the legacy renderer while recovery occurs. No empty stage and no late commit into another world. Record a reason for diagnostics, avoiding technical popups in the ordinary playback flow.

A fallback is an operational success but not a successful high-fidelity acceptance capture. Evidence must record which renderer and assets actually produced each image.

## 8. File ownership map

Proposed files are intentionally distinguished from existing ones. Paths may be consolidated if one responsibility becomes trivial, but do not silently scatter these contracts across the 8,000-line manager.

| Create | Responsibility |
| --- | --- |
| `tools/terrain/normalize-dem.py` | GDAL-backed metric raster preparation and provenance export. |
| `tools/lib/terrain-source.mjs` | Node wrapper and typed-array decoding for normalized DEM output. |
| `tools/lib/terrain-bake.mjs` | DEM validation, mesh/tile/LOD construction, stable boundaries and bake metadata. |
| `tools/build-range-scene.mjs` | Build one selected view and its manifests/assets. |
| `tools/review-range-views.mjs` | Candidate contact sheets and review reports using the actual scene camera. |
| `data/terrain/scenic-views.json` | Authored candidate/approval catalog and camera rails. |
| `src/world/terrain/SceneCatalog.js` | Validated lightweight runtime view catalog/selection. |
| `src/world/terrain/SceneTravel.js` | Pure progress and camera-pose mapping. |
| `src/world/alpine/RangeFrame.js` | Immutable frame adapter from the existing state. |
| `src/world/alpine/RangeAssets.js` | Validated/cancelable asset preparation with ownership. |
| `src/world/alpine/RangeScene.js` | GPU scene lifecycle and partition rendering. |
| `src/world/alpine/RangePresentation.js` | Existing compositor boundary adapter and explicit fallback. |
| `src/world/alpine/TerrainMesh.js` | Mesh/LOD construction, deformation and material binding. |
| `src/world/alpine/ForestCover.js` | Terrain-constrained stable vegetation and LOD. |
| `src/world/alpine/RockStage.js` | Fixed-ground top surfaces, basin/wet masks and occlusion. |
| `src/world/alpine/WetReflection.js` | Reflections of actual performer layers on exact receivers. |
| `src/render/PerformerCapture.js` | Pooled single-draw performer body capture. |
| `src/render/GraphicsResidency.js` | Reservations, pinning, cancellation, release and diagnostics. |
| `tools/build-range-runtime.mjs` | Local pinned dependency bundle and required runtime files. |
| `tools/range-runtime-entry.mjs` | Explicit entry exporting only the engine/addon APIs actually used. |
| `src/dev/range-scene-review.html` | Diagnostic terrain viewer using the same mesh and camera modules as production. |
| `tools/range-scene-smoke.mjs` | New full-scene pixel/motion/export and lifecycle evidence. |
| `src/assets/range/v2/` | Actual runtime manifests, geometry, textures and provenance notices. |

Existing integration owners: `BiomeManager.js`, `Renderer.js`, `PerfGovernor.js`, `RangeLibrary.js`, `BiomeSet.js`, `RangeMatcher.js`, `RangeHistory.js`, `RealBiomes.js`, `GroundMaterial.js`, `GroundResponse.js`, `ValleyAtmosphere.js`, `RidgeComposition.js`, `WorldRegistry.js`, `src/main.js`, `SongRecorder.js`, `tools/bulk-export.mjs`, server/staging/landscape tools and their relevant tests.

Do not modify all of these just because they are listed. Each task below names its actual changes. Preserve public signatures where adapters suffice.

## 9. Execution order and completion checkpoints

Work in one isolated feature branch, with coherent commits per task. The plan is one implementation program with several testable milestones. The moving pilot is an intermediate fidelity checkpoint; it is not permission to abandon catalog completion and hardening.

| Milestone | Tasks | Required result |
| --- | --- | --- |
| Honest baseline | 0–1 | Reproducible state/quality and side-effect-free body rendering. |
| Real surface | 2–4 | Georeferenced terrain and camera proof from real data, with visible spurs/valleys. |
| Working app integration | 5–8 | Curated assignments, finite travel, resource ownership, actual stage/export integration. |
| Reference-quality pilot | 9–13 | Detailed materials, forest, ground, local light, mist, and a live 20–30 second scene. |
| Complete rollout | 14–17 | Transitions, all biome coverage, lifecycle/performance, verified delivery. |

Do not expand a visually weak pilot across every biome. Diagnose and improve the actual surface/camera/material problem, then continue. Do not stop and request approval merely because the plan reaches a milestone.

### Task 0 — Establish execution state and preserve the evidence

**Modify/create:** execution branch; `docs/superpowers/plans/2026-09-29-range-geodata-master.md` copied from this file; `docs/range-v2-progress.md`; reference/evidence pointers under `docs/`.

**Consumes:** this complete package, actual repository instructions, current main. **Produces:** an isolated branch, reconciled source map, current-state checkpoint.

- [ ] Read repository `AGENTS.md` instructions if present, inspect the working tree, fetch current main, and compare it with the audited SHA. Preserve unrelated work. Use a worktree when needed.
- [ ] Read this whole plan and inspect the original reference plus both current captures. Record which audit findings still apply after any main changes.
- [ ] Run the baseline commands once after locked dependency installation. Reuse the supplied baseline only as historical evidence.
- [ ] Record base/head SHA, branch, tool availability, actual browser/GPU/device access, and the next task in `docs/range-v2-progress.md`.
- [ ] Commit the plan/checkpoint and any necessary baseline evidence metadata. Do not commit downloaded national DEM caches or browser binaries.

**Verify:** `git status --short`, `npm test`, `npm run lint`, `npm run stage:site`. A baseline failure must be recorded and resolved when it blocks affected work; do not attribute it to new code that does not yet exist.

### Task 1 — Repair quality evidence and render-time state changes

**Modify:** `src/render/PerfGovernor.js`, `src/sim/Broshi.js`, `tools/lib/landscape-browser.mjs`, `tools/lib/landscape-evidence.mjs`, `tools/lib/landscape-fixtures.mjs`.  
**Tests:** extend `test/perfGovernorConsumers.test.js`, `test/broshi.test.js`; create `test/rangeEvidenceState.test.js`.

**Interfaces:** add `PerfGovernor.setFixtureLevel(level: number | null): void`; add an explicit recorded actual level/draw count to the fixture evidence. Preserve ordinary export's full-quality request.

- [ ] Write failing tests: a fixture pin of 6 remains 6 after `holdQuality` assignment and repeated `sample()` calls; clearing it restores normal behavior. Validate integer levels 0–6 and reject invalid values.
- [ ] Implement a separate fixture override with defined precedence over hold/export mode only when explicitly active. Use `try/finally` cleanup in fixtures so the override cannot leak into later playback.
- [ ] Write a failing test that draws Broshi twice at one time and compares both the simulation state and the next value from his behavioral RNG against a control instance.
- [ ] Move rho render variation to stateless seed/time-derived values or a separate render-only deterministic source. Do not consume behavior RNG inside draw.
- [ ] Apply fixture lighting, biome, camera and pass configuration before the final draw at the requested time. Remove the extra final renderer draw after `renderExportFrame()`; retain any explicitly required earlier assembly capture at its own timestamp.
- [ ] Extend evidence with actual quality, draw count, generation, resolved lighting, active production passes, and actual renderer. Run focused tests, capture levels 0 and 6, inspect them, and commit.

**Key assertions:** `actualLevel === requestedLevel`; repeated draw leaves behavior state equal; exactly one final draw at the requested frame time; fixture teardown restores original settings. Merely reversing the two old quality assignments is insufficient.

### Task 2 — Normalize real elevation with an explicit coordinate contract

**Create:** `tools/terrain/normalize-dem.py`, `tools/lib/terrain-source.mjs`, terrain fixture metadata and tiny synthetic rasters under `test/fixtures/terrain/`. **Modify:** `tools/fetch-terrain-grid.mjs` only for a reusable source/provenance export if needed. **Test:** `test/terrainDemContract.test.mjs` and a small GDAL integration invocation.

**Interfaces:** `normalizeDem()` produces `DemGrid` as specified in §7. Node callers execute the Python CLI with structured arguments and read its metadata/binary outputs.

- [ ] Define a versioned input/output schema, little-endian height payload, validity mask, coordinate transform, units, datum, source resolution, output spacing, and provenance.
- [ ] Create fixtures for a known sloped plane, a branched ridge/valley surface, a no-data hole, non-square geographic pixels, and an explicitly rotated grid. These synthetic fixtures are tests, not purported real terrain.
- [ ] Implement Terrarium-grid import and GeoTIFF normalization; use GDAL for real reprojection/alignment. Preserve validity instead of filling missing cells with zero.
- [ ] Acquire a bounded real North Cascades or Skagit candidate using available documented data. Record exact source IDs, URLs, license, hashes, dimensions, projection and vertical reference.
- [ ] Verify labeled source points round-trip through the transform within the declared sampling tolerance, a known slope retains its orientation, and interpolation does not invent extra source resolution.
- [ ] Run the focused contract test, record the real normalization command/tool versions, and commit the recipe/fixtures/metadata.

**Reject:** swapped latitude/longitude, north/south mirroring, unexplained vertical offsets, baked apparent-angle values substituted for elevations, or a resampled grid mislabeled as higher-resolution measurement.

### Task 3 — Bake connected terrain and bounded detail levels

**Create:** `tools/lib/terrain-bake.mjs`, `tools/build-range-scene.mjs`, `src/world/alpine/TerrainMesh.js`, `tools/build-range-runtime.mjs`, `tools/range-runtime-entry.mjs`, `test/terrainBake.test.mjs`. **Modify:** `package.json` and lockfile for the pinned renderer/build dependencies. **Output:** initial real geometry under `src/assets/range/v2/`.

**Interfaces:** `bakeTerrain(grid, view, options)` and `validateTerrainManifest(manifest, byteLengths)` from §7. Define one documented manifest version with explicit buffers and hashes.

- [ ] Write failing tests on the plane/branched fixtures: decoded vertex elevations follow valid input samples; branch and valley extrema survive the accepted LOD error; no-data holes are excluded; tile shared-edge samples agree exactly before quantization.
- [ ] Pin Three.js and the minimal dependency-bundling tool, add the explicit bundle entry, and implement `node tools/build-range-runtime.mjs` so the mesh/camera review in the next task already has a local engine. This is the same bundle later shipped by staging, not a separate prototype dependency stack.
- [ ] Build tiled geometry with shared boundaries, metric UVs, surface normals and stable source IDs. Carry usable slope/aspect/curvature-derived masks without claiming they are measured vegetation.
- [ ] Build detail levels and their geometric-error metadata. Test mixed-LOD neighbors and compute projected error under the candidate camera.
- [ ] Validate malformed/truncated buffers, invalid indices, NaNs, unsupported schema versions and incompatible source transforms before GPU construction.
- [ ] Bake the actual candidate terrain. Produce a neutral-light surface, normal view and depth view. Confirm large and medium form before textures or fog.
- [ ] Run `node --test test/terrainBake.test.mjs`; inspect a rotating diagnostic view solely to find geometry defects, then return to the production camera; commit code and actual deliverable assets.

**Acceptance:** the main crest visibly connects to real secondary spurs and intervening valleys. More silhouette polylines or a fan of decorative face triangles does not satisfy this task.

### Task 4 — Prove and curate the first camera corridor

**Create:** `data/terrain/scenic-views.json`, `tools/review-range-views.mjs`, `src/dev/range-scene-review.html`, `src/world/terrain/SceneTravel.js`, `test/sceneCamera.test.js`.

**Interfaces:** `cameraPoseAt(view, progress01): CameraPose`; candidate review reports reference a view ID, source hashes and camera manifest hash.

- [ ] Add several candidate straight camera rails for the real pilot terrain, using explicit source-space coordinates. Generate five-station contact sheets with silhouette/depth/neutral-light views.
- [ ] Run the review viewer from the local `/src/dev/` route with the bundled engine, shared `TerrainMesh` adapter and `cameraPoseAt()`. The tool drives it with Playwright. It must not depend on `RangeScene`, which is integrated later, or on a different camera implementation.
- [ ] Write tests for exact endpoint poses, midpoint interpolation, bounded clamping, consistent world-up, invalid FOV/degenerate eye-target rejection, and aspect-ratio-independent geographic position.
- [ ] Inspect both potentially useful sides and compare eye height, distance, lateral segment and framing. Use real view output, not a name-based assumption about spectacular mountains.
- [ ] Select the first corridor that has connected relief, an open stage sightline, adequate terrain bounds, and sustained composition. Record rejected alternatives and concise reasons.
- [ ] Validate all 21 path stations and a continuous traverse for data edges, geometry cracks, occlusion and feature stability. Save the approved camera/terrain evidence and commit.

At this task, approval is for the geometry/camera review only. Keep the view's production `status` as `candidate`; the material and full-app pilot in Task 13 must pass before it becomes an approved production selection.

**Acceptance:** the pilot remains a strong landform with flat material and no atmosphere. The camera cannot leave the source bounds, and widening/portrait reframing must not reveal unmodeled voids.

### Task 5 — Add curated scene assignment without breaking biome identity

**Create:** `src/world/terrain/SceneCatalog.js`, `test/sceneCatalog.test.js`. **Modify:** `src/world/terrain/RangeLibrary.js`, `BiomeSet.js`, `RangeMatcher.js`, `RangeHistory.js`, and `src/world/RealBiomes.js` only where needed for the new assignment adapter.

**Interfaces:** `chooseSceneForBiome()` and `SceneChoice` from §7. Extend prepared terrain with a `sceneByBiome` map and `catalogVersion`; leave legacy `byBiome` available for fallback and existing skyline consumers.

- [ ] Write tests for rejected candidates, wrong-biome views, deterministic sorting/seeds, all-recent pools, one-view pools, no-view pools and catalog-version identity.
- [ ] Implement the separate approved scenic pool and 15/85 diversity/character weighting. Preserve the existing home-biome policy under a distinct name; do not alter its distribution accidentally.
- [ ] Store per-song scene assignment and generation. Extend history to view/region IDs while preserving existing range history behavior.
- [ ] Allow one connected view to supply its depth structure; do not force three distinct ranges into the new scene or synthesize substitute hills when a biome has only one approved view.
- [ ] Keep old-biome fallback explicit during migration and preserve five-biome/section-label/opening stability.
- [ ] Run focused selection tests and a deterministic distribution check over the existing music evaluation fixtures; record which approved views appear, then commit.

**Acceptance:** no unapproved scenic view is selected, no ecology is falsified for variety, and the musical skyline pool still follows its separate intended policy.

### Task 6 — Map heard-time to finite source travel and frame state

**Modify:** `src/world/terrain/SceneTravel.js`; **create:** `src/world/alpine/RangeFrame.js`, `test/sceneTravel.test.js`, `test/rangeFrame.test.js`. **Integrate:** `Renderer.js`/`BiomeManager.js` through narrow adapters.

**Interfaces:** `sceneProgressAt()` uses the exact mapping in §5.2. `RangeFrame` contains resolved time, assigned views, transform state, light, music, support bars and emitters.

- [ ] Write tests comparing the adapter with `terrainScrollPx()` at known times, including silent curves, a long track, reduced flash, repeated seeks and midpoint preview.
- [ ] Implement the mapping without frame-to-frame accumulated movement. Test that resolution, DPR and quality changes do not move the geographical camera.
- [ ] Snapshot all state required by Range rendering before drawing, including the actual interpolated performer pose and correct heard-time. Do not pass the mutable `sim` object into new material/asset modules.
- [ ] Define a shared deterministic terrain deformation sampler from existing envelopes; include its coordinates and units in the contract.
- [ ] Assert equal frame state at the same seed/time after forward and backward seek, and no active-time drift during pause. Run focused tests and commit.

### Task 7 — Own resources and ship local dependencies

**Create:** `src/render/GraphicsResidency.js`, `src/world/alpine/RangeAssets.js`, `test/graphicsResidency.test.js`, `test/rangeAssets.test.js`. **Modify:** `src/world/terrain/TerrainStripCache.js` and `src/world/BiomeManager.js` for shared legacy ownership, the runtime bundle from Task 3, `tools/stage-site.mjs`, `tools/serve.js`, `test/stageSite.test.mjs`; package/lockfile only if this task introduces an additional required decoder.

**Interfaces:** reservation and asset-preparation contracts in §7. All decoded/uploaded resources have an owner and generation.

- [ ] Write tests: reserve denial performs no allocation; pending→live commit is not double-counted; pinned objects survive eviction; cancellation prevents publication and releases reservations; release/dispose is idempotent.
- [ ] Implement bounded ownership with the initial desktop/mobile budgets and per-category diagnostics. Integrate legacy strip ownership so fallback does not get a second independent allowance.
- [ ] Extend the Task 3 bundle with any actually used decoder/worker/WASM assets and license notices. All additional dependencies must have locked versions and local runtime URLs.
- [ ] Make staging run that build and include real assets. Add appropriate MIME types for the actual formats used, including WASM if needed; preserve the server's path restrictions.
- [ ] Implement manifest validation, verified asset identities, abortable fetch/decode, generation checks, cleanup and preparation errors. Avoid decoding in the animation loop.
- [ ] Test missing/truncated assets, late responses, cancelled decode, budget denial and an offline staged load. Run focused tests/lint/staging and commit.

### Task 8 — Integrate actual terrain with the stage and export surface

**Create:** `src/world/alpine/RangeScene.js`, `RangePresentation.js`, `test/rangePresentation.test.js`; begin `tools/range-scene-smoke.mjs`. **Modify:** `src/render/Renderer.js`, `src/world/BiomeManager.js`, `src/world/WorldRegistry.js`, `src/main.js`; export code only where the surface contract needs a narrow adapter.

**Interfaces:** `RangeScene` from §7; `RangePresentation` owns pass integration and explicit legacy fallback, not simulation.

- [ ] Write a pass-order test that records scenic/fixed-ground boundaries and checks each legacy signature/event remains in its intended position.
- [ ] Integrate the neutral-material real pilot using one GPU context and synchronous partition copies into the completed main stage. Preserve transparency, transform application, coda/assembly ordering and cast visibility.
- [ ] Add `?rangeRenderer=v2|legacy` for diagnostic comparison; default remains migration-safe until the rollout task. Do not overload the old `?renderer=webgl` flag to imply terrain support it does not supply.
- [ ] Add an explicit diagnostic `?rangeView=<view-id>` override for the unfinished pilot and candidate reviews. Report `forcedCandidate: true` when it bypasses production eligibility. Normal song selection must still reject candidates; it becomes eligible after Task 13.
- [ ] Apply any active optional tint/vignette in the authoritative completed surface for v2, or disable its duplicate sibling application while preserving equivalent stage output. Include this state in export equality checks so a visible overlay is not silently omitted or applied twice.
- [ ] Record actual terrain/asset hashes and renderer mode in the new smoke evidence. Extract rendered depth/coverage masks for visibility checks instead of relying only on intercepted Canvas paths.
- [ ] Capture main-stage pixels, a bulk-exported frame, and a frame from the recording route with uniquely colored diagnostic terrain markers. Verify those markers appear in all paths and disappear when their source pass is disabled.
- [ ] Measure partition transfer time and first-frame shader cost. If the contingency in §6.4 is triggered, resolve it now; do not postpone compositor viability until every asset is finished.
- [ ] Test context unavailability and world changes; run focused tests, staged smoke and export checks, inspect output, and commit.

**Acceptance:** real terrain is in the running show and its exported output. An attractive standalone terrain viewer is only supporting evidence.

### Task 9 — Produce and integrate the real material pack

**Modify/create:** actual assets under `src/assets/range/v2/`, material manifests/provenance, `TerrainMesh.js`, `RangeAssets.js`; create `test/rangeMaterialManifest.test.js`.

**Interfaces:** material manifests declare texture role, color space, dimensions, mip/format information, source hash, license and intended terrain scale.

- [ ] Assemble actual rock/snow/soil/moss/sky source assets and document rights/provenance. Build material masks from terrain plus explicit artistic decisions.
- [ ] Implement consistent light/material evaluation, metric source-attached UVs, normal transforms and bounded emissive contribution. Keep neon and global atmosphere out of reusable base color.
- [ ] Validate color/data texture roles, mip seams, atlas gutters and actual closest-view texel density. Do not equate larger image dimensions with added detail.
- [ ] Produce four matched views: geometry only, neutral material lighting, final lighting without fog, and final full scene. Inspect full-frame and 100% detail.
- [ ] Traverse the camera path and apply musical deformation; correct texture swimming, repetitive tiling, broad empty faces, and normal discontinuities.
- [ ] Run manifest checks plus staged browser verification, save the real asset board, and commit.

**Acceptance:** major rock faces have coherent medium and fine structure while macro spurs remain readable. The task is incomplete if the implementation merely lists assets to acquire later.

### Task 10 — Build stable forests that describe the slopes

**Create:** `src/world/alpine/ForestCover.js`, `test/forestCover.test.js`; add production tree/canopy assets and occupancy masks.

**Interfaces:** forest placement consumes source metric coordinates, biome/material exclusions, seed and the shared deformation sampler; outputs stable instance IDs and depth-partition membership.

- [ ] Write tests for deterministic placement, exclusions on cliffs/water/snow masks, valid roots, stable IDs across quality changes, and identical positions after seek.
- [ ] Build varied conifer groups for the pilot using near recognizable forms, middle-distance clusters and remote canopy coverage. Use instancing/batching where it actually reduces cost.
- [ ] Derive placement from slope/altitude/material eligibility; treat ecological masks as authored/derived unless external land-cover evidence is explicitly included.
- [ ] Apply the terrain's source transform/deformation to roots and use heard-time/seed for wind. Reduce density by a stable subset rather than regenerating the forest.
- [ ] Inspect silhouette repetition, alpha halos, billboard transitions, shadows, and trees crossing partition boundaries. Run focused tests plus a moving close/mid/far sample and commit.

### Task 11 — Construct a rock stage and correct water receivers

**Create:** `src/world/alpine/RockStage.js`, `test/rockStage.test.js`. **Modify:** `src/world/alpine/GroundMaterial.js`, `GroundResponse.js`, relevant tests; integrate in `RangePresentation.js`.

**Interfaces:** stage dressing consumes `RangeFrame.groundBars`; exports exact wet polygons, receiver planes, occlusion masks, and dry/wet material regions.

- [ ] Write tests for physical-versus-rendered support alignment, sloped/curved bars, interior humps despite equal endpoint heights, triangular water boundaries, and contact under zoom/shake.
- [ ] Build visible rock top planes and broken edges around the existing support curve. Keep decorative depth separate from physical collision heights.
- [ ] Replace rectangular wet clipping with exact polygon masks. Check basin/interior slope, not only endpoint slope, before placing shallow water.
- [ ] Distinguish dry rock, damp rock, moss and water. Keep receivers coherent under rendered ground deformation; reject water that climbs an unsupported hump.
- [ ] Inspect actual landing/jump/contact clips with all characters and camera states. Validate dry-corner pixels remain unaffected in a nonrectangular receiver test.
- [ ] Run focused ground tests and staged imagery, then commit.

### Task 12 — Capture the live cast once and reflect its real shape

**Create:** `src/render/PerformerCapture.js`, `src/world/alpine/WetReflection.js`, `test/performerCapture.test.js`, `test/wetReflection.test.js`. **Modify:** `Renderer.js`, `GroundResponse.js` and the narrow body draw adapters.

**Interfaces:** `capturePerformerLayers()` and `drawWetReflections()` from §7. A layer is valid for exactly its frame ID until all consumers finish.

- [ ] Write tests counting one body draw per visible performer per frame, verifying unchanged behavior RNG and identical body/reflection frame IDs.
- [ ] Capture tightly bounded transparent body layers with correct light inputs and glow padding. Recompose each body at its original cast position in the pass order; do not capture/repaint the entire main scene.
- [ ] Project live layers into receiver space with actual airborne/contact height, hue and visibility. Add bounded distortion, roughness attenuation and exact polygon/rock masking.
- [ ] Handle Broshi's burrow, Midasus's distant voyage, partial offscreen subjects, negative bounds and changing body size without stale buffer content.
- [ ] Run a moving pose/hue/height comparison and pixel tests showing no reflection outside the wet mask. Compare paused and re-seeked frames.
- [ ] Run focused tests and actual export checks; inspect the real reflection shapes and commit.

### Task 13 — Finish atmosphere, local light and the moving pilot

**Modify:** `ValleyAtmosphere.js`, `RangeScene.js`, `TerrainMesh.js`, `RockStage.js`, relevant sky/presentation hooks. **Create:** `test/rangeAtmosphere.test.js`; extend the new smoke tool.

**Interfaces:** atmosphere consumes terrain depth/gap regions and resolved light/time; local response consumes current emitter state in the correct coordinate system.

- [ ] Write tests for nearer-object fog occlusion, zero-density identity, bounded local light influence, reduced-flash response, and pause/seek phase stability.
- [ ] Replace regular oval valley stamps in the new scene with irregular basin/gap density, clipped or attenuated by depth. Keep distant atmospheric perspective separate.
- [ ] Add compact material-dependent local illumination and wet response. Resolve the original stage-space light through the scenic/fixed-ground transform boundary before using it.
- [ ] Refine cloud/moon hierarchy and sky competition without removing SpaceRidge or Dancing Ridge. Optional waterfalls need an attached source/channel/receiver and their own budget; omit them until those conditions are satisfied.
- [ ] Capture a full-production 20–30 second pilot at the intended display size, plus calm and high-energy samples. Include the opening transition and one backward seek.
- [ ] Inspect reference versus actual output for every visual criterion in §11. Correct weak geology, material scale, forest or contact directly; do not conceal them with fog.
- [ ] Save matched stills, motion, metadata and remaining limitations; run relevant tests and commit.

Once the full pilot passes, mark its view `approved`, advance the catalog version and repeat a normal selected-song capture without `rangeView`. The default renderer need not change yet. Record the approved decision against the material, geometry and camera hashes so subsequent asset changes invalidate stale review evidence.

**Acceptance:** the live scene approaches the reference's form, depth, material richness and light hierarchy. This is the point to resolve artistic insufficiency before multiplying assets, not a permission gate.

### Task 14 — Preserve transitions, framing and opening behavior

**Modify:** `RangePresentation.js`, `RangeFrame.js`, `RangeScene.js`, `RidgeComposition.js`, lifecycle hooks in `BiomeManager.js`/`Renderer.js`. **Create:** `test/rangeSceneTransition.test.js`, `test/rangeSceneFraming.test.js`.

**Interfaces:** A/B sides carry separate view IDs, preparation handles, local progress/camera and material data; transition time comes from the existing director.

- [ ] Write tests for transition endpoints, 25/50/75% intermediate states, cancelled incoming views, and a failed incoming load while the old view remains valid.
- [ ] Preserve the existing geographic travel/handoff treatment where possible. Composite separate scene surfaces through its transition mask instead of interpolating unrelated mountain vertices into a melting landscape.
- [ ] Reserve both sides and their temporary composition buffers before handoff. Release outgoing ownership only after it is no longer used.
- [ ] Reframe for 16:9, reference-wide and portrait while preserving character proportions, support position and geographic progress. Include maximum existing zoom, shake/roll overscan, and DPR changes.
- [ ] Preserve the 8-bit-to-full-detail opening and assembly capture timing; prevent shader/asset warmup from turning the opening into a frozen placeholder.
- [ ] Measure visibility against rendered occluder masks at 21 stations and all transition samples. Preserve the existing 0.55 far-exposure regression protection unless a documented replacement proves equivalent musical readability; it is not the only visual criterion.
- [ ] Run focused tests and continuous transition/resize clips, inspect for seams/pops/blank borders, then commit.

### Task 15 — Complete the curated catalog across all biomes

**Modify:** `data/terrain/scenic-views.json`, generated runtime catalog, approved terrain/material packs, `RealBiomes.js` only for evidence-backed classification corrections; extend `test/sceneCatalog.test.js` and material policy tests.

**Interfaces:** same `SceneView` contract; no special-case schema for each region. Update catalog version when assignments/content change.

- [ ] Build a coverage table for the 11 biomes and choose strong candidate corridors, using the proven bake/review process. Aim for 12–18 total approved views; document justified additions.
- [ ] Produce appropriate art packs and surface masks for ice/tundra/taiga, forest types, chaparral, steppe, canyon and desert. Do not recolor one wet alpine scene and call it every biome.
- [ ] Run five-station candidate reviews, then 21-station and motion acceptance for each final view. Record approved/rejected status and reasons with actual asset hashes.
- [ ] Test that every biome has a valid approved scene, correct habitat/material permissions, deterministic song/section assignment and a working fallback.
- [ ] Run natural song casts as well as forced fixtures so the production selector is exercised. Confirm the sky-signature pool and tempo/character response remain present.
- [ ] Remove rejected scenery from the v2 production pool while retaining original source data for diagnostics. Commit the complete deliverable catalog and its provenance/review reports.

**Acceptance:** all intended biomes work with the new system. One excellent rainforest scene plus old placeholders elsewhere is a pilot, not the completed master plan.

### Task 16 — Prove resource, lifecycle and performance behavior

**Modify:** residency/asset/quality scheduling as evidence requires; extend `tools/range-scene-smoke.mjs`; create `test/rangeSceneLifecycle.test.js`.

**Interfaces:** diagnostic reports include actual renderer, actual quality, ownership by category, generation, pending jobs, and preparation/transfer/frame timings.

- [ ] Add failing tests for all-pinned allocation denial, repeated resize, stale fetch completion, context loss/restoration, world replacement and idempotent disposal. Keep allocation faults injectable.
- [ ] Run repeated song/world/biome replacements and A/B transitions near the budget. Demonstrate ownership returns to a stable baseline after release rather than rising per cycle.
- [ ] Define quality reduction order: far texture detail, stable foliage subset, fog sampling, reflection distortion and optional effects first. Preserve landform structure, contact, performer cores and musical signatures. Add hysteresis to prevent oscillation.
- [ ] Measure real-device steady-state and cold/transition behavior where hardware is available. Include a 10-minute phone run for sustained behavior, not a short cold-device screenshot.
- [ ] Report target dimensions/backing resolution/DPR, browser, device/GPU, actual quality, median/p95/p99 frame intervals, >100 ms stalls, ownership peaks and copy/upload costs.
- [ ] If physical hardware is unavailable, finish the instrumented browser/lifecycle work and provide exact device-run instructions. Mark device acceptance unverified; do not convert software-headless results into claimed mobile FPS.
- [ ] Optimize the demonstrated bottleneck, rerun only affected checks, and commit evidence-backed changes.

### Task 17 — Verify complete output and deliver the implementation

**Modify:** regression/evidence tooling and `.github/workflows/landscape-visual.yml` as required; add `docs/range-v2-validation.md`, asset/build documentation, and final progress record.

- [ ] Make the evidence tool hash the new renderer modules, scene/catalog/material manifests, actual loaded buffers/textures, and local runtime bundle. Include these identities with every capture.
- [ ] Run the final command sequence in §10 from the staged site. A staged response/hash check must prove the browser is testing this branch's actual files.
- [ ] Inspect the final reference comparison, natural production frames, moving clips, masks, actual bulk export and recorded video frames. Keep diagnostic pass-disabled images labeled separately.
- [ ] Run the final review against §11, record each criterion as pass/fail/unverified with its artifact path, and resolve failures. Passing unit tests cannot override a visibly poor result.
- [ ] Enable v2 as the default only after the complete catalog and required non-device gates pass. Keep `?rangeRenderer=legacy` and automatic operational fallback. Any unavailable device gate must remain explicitly unverified in delivery.
- [ ] Review the complete diff for accidental deletions, hidden pass suppression, stale assets, unrelated changes, copied full reference imagery in production, and misleading validation claims.
- [ ] Commit coherent code/assets/tests/docs. If the execution request authorizes publishing, push the feature branch and open a PR against `main` with before/after images, the moving pilot, source provenance, validation results, limitations and fallback details. Do not merge or deploy unless separately authorized.

## 10. Verification commands and evidence matrix

Run focused tests during each task; do not run the complete browser matrix after every small reversible edit. Finish with the full relevant gates once, then rerun only checks affected by a correction.

### Repository and staging

```sh
npm ci
npm test
npm run lint
npm run stage:site
git diff --check
```

Run dependency install once per dependency change. The new staging integration must rebuild the local runtime bundle and verify actual runtime assets. Run a loopback server against the staged tree in a separate process:

```sh
SITE_ROOT="$PWD/_site" node tools/serve.js 8092
```

The executor may use equivalent process/environment syntax on Windows. Do not expose the server externally merely to run tests.

### Existing browser contracts

```sh
npm run test:bootstrap -- http://127.0.0.1:8092
npm run test:smoke -- http://127.0.0.1:8092
npm run test:worlds -- http://127.0.0.1:8092
npm run test:seek -- http://127.0.0.1:8092
npm run test:export -- http://127.0.0.1:8092
node tools/range-landscape-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" --expect-sha "$(git rev-parse HEAD)" --preset full --output .smoke/range-v2-legacy-contracts --stage candidate
```

The landscape script checks source identity; commit the intended candidate before final captures, or extend the evidence explicitly to record dirty-file hashes without pretending they equal committed HEAD. Verify actual supported preset names on execution and preserve their coverage if upstream changes them.

### New scene suite

Task 8/17 must implement this exact public CLI, with named arguments and nonzero exit on failed required checks:

```sh
node tools/range-scene-smoke.mjs --url http://127.0.0.1:8092 --source-root "$PWD" --expect-sha "$(git rev-parse HEAD)" --suite complete --output .smoke/range-v2
```

Suites: `pilot`, `selection`, `motion`, `lifecycle`, `export`, `complete`; complete runs all required groups once and emits JSON plus reviewable frames/clips. Record unsupported codec/device cases as unverified, not a pass. Fixtures may use synthetic licensed test audio, but final evidence must also include a natural cast from available authorized audio.

| Dimension | Required cases |
| --- | --- |
| Light | Resolved blue-hour state, day, night; record actual light values rather than guessing a timestamp. |
| Music | Calm, sustained energetic section, transient/drop, ending, opening style progression. |
| Geometry | 21 path stations, LOD boundaries, near terrain edge, no-data exclusion, neutral-material surface. |
| Viewport | 1920×1080, 1280×720, reference-wide aspect, portrait 390×844, DPR 1 and 2 where available. |
| Camera | Normal, maximum supported pullback, shake/roll overscan, resize while paused and playing. |
| Quality | Actual levels 0 and 6, an adaptive down/up transition, reduced flash. |
| Cast | All three performers where eligible; jumps/landings, Broshi rho/burrow, Midasus voyage, hue changes. |
| Time | Normal playback, pause/resume, repeated same-time render, forward/backward seek, long track. |
| Transition | A/B 0/25/50/75/100%, failed incoming asset, budget-limited handoff. |
| Delivery | Main-stage PNG, actual bulk export, actual recorder output, offline staged runtime assets. |
| Lifecycle | Repeated track/world replacement, abort/late response, decode failure, context loss/restoration, disposal. |
| Regression | Every non-Range world, universal transport and opening behavior remain functional. |

Do not run a full Cartesian product. Use a small pairwise set for broad dimensions, plus the explicit critical cases above. Keep approved view station reviews separate from expensive all-world playback.

## 11. Visual acceptance that cannot be satisfied by a boxy mockup

For each row, attach the actual artifact and a short observed judgment. Automated metrics support that judgment; they do not replace it.

| Criterion | Required evidence | Failure condition |
| --- | --- | --- |
| Real landform | Neutral-light geometry, source landmarks and final frame | Branches are invented face panels, the mountains are still flat bands, or geography cannot be traced to source data. |
| Internal relief | Close/mid/far views with texture disabled | Only the skyline is detailed while the mountain face is empty. |
| Composition | Full frame at 21 stations and portrait/wide variants | A high slab repeatedly blocks the scene, central depth is absent, or performers shrink into empty space. |
| Materials | 100% output and closest-view details | Upscaled blur, repetitive stamps, faceted poster shading, or random noise substituting for rock structure. |
| Forest | Moving roots/crowns at several distances | Repeated pine fences, floating roots, visible billboard edges, or trees sliding over the slope. |
| Ground | Landing/jump clip and fixed-ground camera comparisons | Smooth apron, disconnected stones, water climbing humps, or decorative geometry implying unsupported footing. |
| Reflection | Actual moving body and reflected shape together | Wrong pose/hue/height, generic glow ellipse, stale previous frame, or pixels outside the wet receiver. |
| Atmosphere | Fog off/on and depth occlusion comparison | Regular oval stamps, a uniform wash, or haze hiding weak terrain. |
| Musical identity | Calm and peak-energy production clips | Dancing Ridge/SpaceRidge removed, secretly suppressed, visually buried, or slowed by the scenic travel adapter. |
| Temporal coherence | 20–30 second pilot, seek and transition clips | Texture swimming, forest regeneration, visible tile cracks/pops, or paused animation. |
| Catalog quality | Contact sheets and complete biome coverage | Weak views included for fairness, several near-duplicates, or the same alpine scene recolored for every biome. |
| Export fidelity | Displayed stage and actual exported/recorded frames | New scenery, signatures, local light or reflections are absent from output. |
| Performance honesty | Real measurement report with actual dimensions/quality | Software screenshots labeled as device FPS, hidden resolution reduction, or disabled effects used to claim the target. |

Inspect the reference side by side with the app at equal displayed size, then inspect full-size crops. Also inspect a downscaled grayscale frame to judge large form. The final images must include the real production effects and cast. A generated picture or attractive terrain-tool screenshot cannot stand in for those captures.

No claim such as “95% match” is required or defensible without a defined evaluation. State what visibly matches, what differs, and what remains unverified.

## 12. Progress, context recovery, and delivery

Maintain `docs/range-v2-progress.md` with: current branch/head; last completed task; exact next action; current asset/catalog hashes; commands and outcomes; measured visual/performance issues; unresolved blockers; and files carrying active changes. Update at meaningful checkpoints, not after every tiny edit. On context restart, read it, inspect git state, and resume instead of redoing completed work.

Use commits to make each task independently reviewable. If parallel work is authorized, delegate only isolated tasks with these interfaces and one clear owner per shared file. Keep integration and visual acceptance under one responsible implementer. Do not use delegation as a substitute for inspecting final application output.

Do not end after planning, scaffolding, a data downloader, a gray terrain viewer, or the first pilot. Continue through catalog completion, integrated visual verification, lifecycle checks and delivery. If a real external limitation prevents a required result, identify the exact missing capability/data/access and completed work; never relabel it as complete. The user's non-binding-approval preference does not authorize bypassing actual tool permissions.

Final implementation delivery must include:

- Feature branch/commit and PR link when publishing was authorized.
- Actual code, committed runtime assets, reproducible acquisition/bake/bundle recipes and provenance.
- Full-production before/after images, a 20–30 second pilot, and motion/seek/transition evidence.
- Approved catalog contact sheets and biome coverage table.
- Test/lint/staging/browser/export results with exact source/asset identities.
- Device measurements or an explicit unverified-device statement and runnable measurement instructions.
- A concise explanation of the major architectural changes, known limitations and legacy fallback.

## 13. Source references and package contents

The source findings are pinned to [the audited commit](https://github.com/aepler315/Midio-5/tree/b8a3d72b344792d149906449f1cd86d68df8cc2b). The supplied audit links individual code locations. This plan's module names, budgets, camera rail, selection policy and task structure are proposed engineering decisions, not claims that those APIs already exist.

Primary documentation consulted for the mechanism choices:

- [USGS 3DEP products and services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services): available elevation products, spacing, metadata and bare-earth distinctions. Coverage must be checked per selected source.
- [GDAL warp](https://gdal.org/en/stable/programs/gdalwarp.html): explicit reprojection, resolution, crop and no-data controls. Pin the actual offline tool version in the build record.
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html): renderer/context/target lifecycle; use the API matching the pinned dependency.
- [Three.js color management](https://threejs.org/manual/pages/color-management.html): color versus data textures and output conversion.
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) and [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html): batching and optional compressed-texture support.
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices): resource limits and avoidable upload/allocation costs.

The handoff archive contains this master plan, `OPUS-START-HERE.md`, the unmodified reference, the current day/night captures, the original audit and capture report, and the earlier audit evidence bundle. The evidence is historical; the implementing agent must generate new evidence for its own changes.
