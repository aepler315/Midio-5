# Circular Journey Implementation Plan

**Goal:** Make Moonlit Journey a circular mountain world with automatic 2.5D travel.

**Architecture:** Keep intrinsic terrain and performance sampling separate from radial presentation. Optional circular state and shader uniforms preserve existing flat-world consumers; JourneyScene enables the new presentation.

**Tech stack:** JavaScript, Three.js, GLSL3, Node tests and Playwright WebGL captures.

**Spec:** `docs/superpowers/specs/2026-10-06-circular-journey.md`

## Global constraints

- Radius 1800 m, depth scale 0.18, mountain relief scale 0.36.
- Heard time determines travel; no per-frame accumulated simulation.
- No added dependencies. Other range worlds retain their existing projection.
- Preserve naturalistic textures, water optics, cast identities and stellar artwork.

## Review focus

- Periodic value and normal continuity at one full circumference.
- CPU/GLSL agreement and finite behavior after long seeks.
- Radial cast foot contacts, companion bases and water clipping.
- Full-circle silhouette and normal rim framing across aspect ratios.
- Context recovery, shader compilation and residency ownership.

## Tasks

- [x] Root: add `JourneyOrbit.js` with pure projection, basis, inverse and matching GLSL; test radial altitude, closure and inverse. Integrate scene camera, core, bounds, star mask and render lifecycle.
- [x] Fields worker: add optional `circular` state to `JourneyWorld.js` and periodic circular fields to it and `JourneyMountains.js`; retain default flat behavior. Verify heights, shores and slopes close at circumference and geography follows travel.
- [x] Materials worker: project surface, water, trees, dressing and shadow geometry through the adapter; carry intrinsic material coordinates and radial slope; limit planar reflection to a tangent patch. Verify actual shader compilation and geometry closure with the integrated browser capture.
- [x] Cast worker: add radial pose conversion and optional up basis to `CoveGL.js`, preserving vertical defaults and contact/shadow/companion semantics. Verify deterministic pose and foot reconstruction.
- [x] Root: integrate and capture actual rendered shots; resolve visual problems, run tests/lint/staging, obtain focused independent review and publish the branch/PR.

## Shared interfaces

`JourneyOrbit.js` exports `JOURNEY_ORBIT` (`radiusM`, `circumferenceM`, `depthScale`, `reliefScale`), `journeyOrbitPoint([x,h,z])`, `journeyOrbitBasis(x)` (`right`, `up`, `forward`), `journeyOrbitInverse([x,y,z])`, `journeyOrbitVector([x,y,z], localX)` and `JOURNEY_ORBIT_GLSL`.

GLSL functions: `journeyOrbitPoint(vec3)`, `journeyOrbitUp(vec3 world)`, `journeyOrbitVector(vec3 intrinsicVector,float x)`, `journeyOrbitAltitude(vec3 world)`. Uniform `uJourneyOrbit` is 0 for flat and 1 for circular. The helper functions respect this uniform. `JOURNEY_SURFACE_GLSL` includes this block once. Materials add the block separately only to shader stages not already using the surface block.

`sampleJourneyState({..., circular = false})` returns `circular`; circular `travelM` remains unwrapped on CPU. Scene sends wrapped `travelM` to shaders. CPU geography uses periodic longitude, independent of `timeSec`. `journeyOrbitCast(pose)` returns a converted pose while keeping `swimmer` intrinsic for the water shader.
