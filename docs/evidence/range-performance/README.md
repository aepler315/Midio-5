# Range moonlit cove

The default Range view passes along Muncho Lake's geographic shoreline.
Broshi rests on wet gravel, Midio is partly submerged among reeds, and
Midasus drifts above and behind them near a pine. They form an asymmetric
triangle at different real depths. Scattered rocks follow the bank; there
is no shared platform.

The retained angular character kit now has shallow faceted bodies and fine
luminous edges. Inhabitants, rocks, reeds and pine share terrain lighting,
depth and the lake mirror. Water cuts Midio's lower silhouette; the pine
and reeds overlap the figures. Broshi's root follows the ground, with a
small contact shadow and restrained leaning instead of beat-driven jumps.

Bass presses into nearby water, rhythm sends rings from Midio's waterline,
and melody guides Midasus and its small companions. Poses and local light
use the canonical heard-time history, including source fallbacks, pitch
confidence, physical silence and analysis handoff. Silence keeps the
residents present and still. Seeking rebuilds the same poses without frame
history. Reduced motion freezes movement; reduced flash limits changing
light and water responses.

| Sunset — 1 s | Moonlight — 30 s | Sunrise — 59.5 s |
| --- | --- | --- |
| ![Cove at sunset](trio-sunset.png) | ![Cove in moonlight](trio-moonlight.png) | ![Cove at sunrise](trio-sunrise.png) |

The [portrait output](trio-portrait.png) fits the same composition. Dense
stars and sunset → moonlight → sunrise remain. The closer camera uses a
physical reflection; reflected rays beyond the visible sky capture fade
into sky color, excluding transparent overscan and portrait letterboxing.

[Capture results](summary.json) record source identity, actual GL color and
depth ownership, actor projections, trio-on/off pixel differences, lake
uniforms, stars, seeking, held-time repeatability and accessibility. The
pixel comparison hides only the trio and their depth copies, retaining the
shoreline dressing. The test opens Auto without a `rangeView` override.

The cove is authored and validated only for Muncho. Explicit other views
remain available; `?rangeExperience=landscape` retains scenery-only Range.
Other worlds keep their presentation. Habitat geometry has a reserved GPU
budget and follows the existing preparation, eviction and disposal paths.

**Validation:** 3,806 tests passed; full lint and diff checks passed. Actual
browser checks passed without page or shader errors, including stable served
source hashes and the final compositor at both output sizes.

These captures use synthetic audio and Chromium software WebGL. Hardware
frame rate remains unmeasured. Camera and anchor checks cover the Muncho
cove and its full lateral rail, including maximum listener zoom.

Reproduce from the repository root with the app served on port 8093:

```sh
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/range-performance-evidence.mjs
```
