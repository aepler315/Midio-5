# Circular Journey

The realistic mountain ranges form one large circular world. The trio performs along its outer rim while geography scrolls automatically beneath them. A shallow depth axis gives the scene the staging of a side-view platformer: foreground shore, lake, first range, rear range. The existing stars remain an independent, steady background.

## World and movement

Use intrinsic coordinates `(s, h, d)` for route distance, altitude and depth. In the current camera-local strip, `s` is `x + travelM`. Project local `x` with `theta = x / radius`: `[(radius+h) sin(theta), (radius+h) cos(theta)-radius, d*depthScale]`. The reference radius is 1800 m and depthScale is 0.18. Mountain relief is 0.36 of the existing valley relief; actor proportions remain unchanged. A solid rocky core closes the interior.

Geography is permanently seeded and periodic over one circumference. Integer angular harmonics replace nonperiodic linear sampling in circular mode. Shores form a broad, irregular connected water belt so Midio can keep swimming without invented land locomotion. Broshi runs on the shore with planted feet; Midasus banks through the air. The local tangent and radial up vectors orient all bodies, companions, props and contact shadows. Music changes gesture and lighting, never travel phase.

Water follows a constant radius with radial normals, depth absorption and sky reflection. The existing planar mirror is valid only in a small tangent patch at the active rim; fade its contribution by angular distance. Material altitude and slope use intrinsic/radial values. Full-circle shots must not reveal a flat water plane, open tube, discontinuous seam or stars through land.

## Camera

Keep the camera upright and its viewing direction steady. Default framing follows the upper rim; retain enough forward space to read automatic travel. Intro and strong phrase arrivals ease back to show the circle, then return to the cast. Full-circle framing is aspect aware; full actor silhouettes fit ordinary follow shots. Reduced motion freezes travel and uses a stable rim composition. No controls, enemies, score or imitation artwork are added.

## Verification

Test periodic heights and shore derivatives, radial projection and inverse/basis, deterministic seeks, stance contacts and reduced motion. Render the real WebGL scene in landscape and portrait at intro, follow, musical reveal and a circumference crossing. Inspect cast visibility, naturalistic materials, water contact and stable stars. Run the existing suite, lint and staging. Preserve other range worlds and their vertical coordinate defaults.
