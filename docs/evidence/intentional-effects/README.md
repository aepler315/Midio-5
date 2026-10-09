Intentional camera and local cast effects
=======================================

Lens accents now select strong choruses, drops, or substantial rises in section
energy. They anticipate the cue by 450 ms, hold for 350 ms and recover over
2.1 seconds, with at least eight seconds between cues. The tangent of the
half-angle narrows by at most 18%; the eye stays fixed and the lens cannot
expose terrain beyond the authored coverage. Preview, reduced motion and
reduced flash suppress these accents. Terrain, celestial projection, cloud
sizes and reflection camera share the lens. The existing small camera
pull-back and tilt now use this selected envelope as well.

The large character cloud figures, terrain silhouettes, shadows and giant
reflections are disabled and their GPU resources are no longer allocated.
All three local lanterns and 72-mote swarms remain, including peak formations,
Midio's wake, Broshi's glow and Midasus's three companions.

Moonlight key, water glints and wet highlights now query cloud transmission
from each receiving surface toward the moon. Covering the camera's moon ray
does not automatically darken every water surface. The reflected sky retains
the clouds painted into it. The model uses the same painted cloud puffs,
placed on a billboard layer at a modeled 12 km depth; it approximates cloud
depth rather than simulating volumetric weather. Existing ambient sky light
remains separate from direct moonlight.

Verification
------------

- `npm test`: 3,854 tests passed; none failed or skipped.
- `npm run lint` and `npm run stage:site` passed.
- Read-only review found an accessibility projection mismatch and missing
  cloud scaling; both were fixed and rechecked. No Important findings remain.
- `cloud-gpu.json` records actual Chromium/SwiftShader shader readback:
  transmission byte 26 for the covered camera ray, 255 for the clear lake ray,
  and 255 for a receiver beyond the cloud. CPU tests also cover a cloud
  shading water, continuous transmission and missing-cloud clearing.
- `browser-smoke.json` and four PNGs exercise neutral lens, accent, recovery
  and moonlight in the actual Range renderer. The generated audio uses
  explicitly authored section cues, a local peak override and a diagnostic
  100-second sky cycle. This does not evaluate automatic audio segmentation.
  Camera and cast state must hold exactly; repeated pixels allow at most one
  color level of rounding, with the exact differences recorded per frame.

Reproduce with the server running:

```sh
npm run dev
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/intentional-effects-smoke.mjs http://127.0.0.1:8080 .smoke/intentional-effects
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/cloud-occlusion-smoke.mjs http://127.0.0.1:8080 .smoke/cloud-gpu.json
```

The software renderer verifies rendering and shader execution. Physical GPU,
phone performance and subjective motion feel still need device review.
