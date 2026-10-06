# Curved Landscape Implementation Plan

**Goal:** Replace the rejected disk composition with a connected curved landscape and readable performers.

**Architecture:** Spherical longitude/latitude projection shared by terrain, water, material normals and cast; a submerged spherical backing replaces the front cap. An oblique close camera and larger, compact cast make the route the main subject.

**Tech stack:** Existing JavaScript, Three.js, GLSL, Node tests and Chromium captures; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-curved-landscape.md`

## Constraints and review focus

- Radius 1800; depth scale .30; circular cast scale 1.6; default flat consumers unchanged.
- Terrain, water, clipping, props and cast must agree on full 3D radius and local latitude.
- Front pole and circumference seam must close without exposed backing or NaN normals.
- Fit full silhouettes at landscape/portrait, with stable camera orientation and safe listener zoom.
- Preserve actual heard-time reconstruction and reduced motion; inspect appearance separately from correctness.

## Work

- [x] Fields: update JourneyOrbit projection/bases/inverse and GLSL; extend JourneyWorld front terrain to pole; replace JourneyCore cap with submerged sphere; test radius/closure.
- [x] Materials: update JourneyMaterial normal/offset frames, spherical water and shoreline inverse; remove invalid planar mirror and point-star sparkle from water; test shader inputs.
- [x] Cast: adapt JourneyCast bases/feet and CoveGL spherical clipping; enlarge circular rigs and compact paths; test ground contacts and flat compatibility.
- [x] Camera: update JourneyOrbitCamera close composition and limited arrivals; update JourneyScene envelope/clearance; test route width, body size and silhouette fitting.
- [x] Render: inspect real landscape and portrait stills, then capture ten seconds of sequential motion; correct visible failures before declaring done.
- [x] Finish: focused review, full suite/lint/staging, publish source and honest visual evidence through GitHub.
