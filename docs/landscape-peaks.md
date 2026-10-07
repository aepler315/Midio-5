# Climax weather and landscape cast

`RangeStorm` selects the loudest measured section, or the strongest sustained window when structural sections are unavailable. Heard time drives the cloud approach, distant rain, snare-lit cloud interior, clearing and wet-land response. Percussion role/channel and GM snare pitch both qualify a flash; a 700 ms spacing limit prevents clusters. Reduced flashing disables lightning. Reduced motion holds advection. No measurements means no invented climax.

The same weather snapshot reaches the sky backdrop, celestial receiver light, water glints, gust amplitudes, wet ground and solar scattering. The clearing strengthens shafts from the actual visible sun; it never creates a light source at night.

Between peaks the three instrument lanes remain small lanterns and motes. At each actor's own peak, its envelope drives metre-scale material masks from the existing rest silhouettes:

- **Midio:** a scene-lit virtual radiance source rendered only through WaterMirror, beyond the far shore and taller than the relief. No matching source draws above the lake. Without visible mirror water, his figure gathers in valley mist and cloud radiance.
- **Broshi:** a projected shadow across terrain and forest. Projection follows the solar key or his own lantern direction; broad lantern spill preserves contrast at dark dawn. Actual receiver positions and scene atmosphere supply shape and occlusion.
- **Midasus:** billowing cloud crowns and cloud/auroral radiance over the valley, spanning the view in world units. Mountains occlude the lower banks.

Cloud radiance has a separate depth-tested copy boundary, so it never contaminates the terrain alpha used for crest light or sampled skylines. Peaks dissolve through the lane envelope and advected billows. There are no enlarged screen-space character meshes. The masks and three radiance quads belong to the prepared view, are reserved before construction, and retire with its actors. Mask CPU data drops after GPU upload.

All giant manifestations drop at quality level 4, alongside the mirror. The small lights remain. `biomes.actorPeakOverride` accepts either a common numeric amount or `{midio, broshi, midasus}` for independent review; `stormOverride` supports weather review. Normal playback uses the measured scores.

Reproduce frames with `npm run test:peaks` and `node tools/peak-evidence.mjs before`. The before mode serves the baseline alpine render modules from commit `96908d0`, with only the independent diagnostic peak selector adapted. The evidence records seed, heard time, actual quality/view, mirror availability and material anchors.
