# Glacial valley flight preview

The Pend Oreille pilot uses USGS 3DEP terrain and an artistic, compressed interpretation of valley-lobe retreat. Ice fills low ground, retreats north, and reveals the bed and river receivers. Forest recovery follows local exposure. It is not a dated reconstruction of ice extent or a glacier-flow simulation.

## Preview

Run `npm ci` and `npm start`, open `http://127.0.0.1:8080/?rangeView=pend-oreille-valley`, upload a song, and select Range. The pilot remains a **candidate** and is available through this URL; normal scene matching continues to use approved scenes. F3 enables debug seeking; the seekbar is hidden by default.

The supplied *Trains* recording lasts 355.653 seconds. Its authored camera path spans 59.32 km, averaging about 600 km/h in world coordinates. Distant terrain, world-up, gradual eye/target curves and damped shake make that physical speed read as coasting. The pilot's ledge sits near the bottom of the frame, with cast support and reflection coordinates moving together.

## Verification

- Full repository suite: **3,520 passed, zero failures**. ESLint and whitespace checks passed; dependency audit reported zero vulnerabilities.
- Website staging verified terrain, material and local renderer hashes. The staged artifact passed its browser bootstrap check.
- Browser audio smoke: **23 checks passed**, including upload, playback, pause/resume, replacement and stop.
- Desktop WebGL samples at 12, 150, 159, 300 and 345 seconds had no page or shader errors. Each repeated scenic GPU capture and its glacier/camera state matched exactly.
- Mobile-budget WebGL samples at 12, 150 and 345 seconds matched scenic/state repeats. Peak tracked residency was **125.31 MiB**, within 128 MiB, with zero overcommit. Budget refusals are recorded in the raw report; the scene remained active.
- Independent review checked package hashes and 17,052 duplicate edge positions with no bed-height mismatch. All pilot tiles use the same stored and runtime LOD so nonlinear ice displacement cannot reopen mixed-LOD seams.
- An ordinary Ross Lake Range frame at 150 seconds rendered its ocean behind terrain, with glacier uniforms disabled, no browser/shader errors and matching scenic repeats: [report](ordinary-range.json).

Raw reports: [desktop frames](desktop-frames.json), [mobile frames](mobile-frames.json). These are software-GL checks; they do not establish hardware frame rate. Full-composite repeat flags are reported separately and are false at some checkpoints. This evidence certifies scenic terrain/state repeatability, not bit-identical repeated Canvas composites.

## Candidate limits

The uniform 128 m terrain topology prevents glacier seam cracks and fits the mobile budget; its surface-normal grid remains 64 m. The ordinary adaptive one-pixel LOD acceptance is **not claimed** for this candidate. The conservative tile-box bed-error estimate is large where a tile bounds the camera; visual and hardware performance acceptance remain necessary before normal matching is enabled.

The ocean now draws before ordinary Range terrain partitions, which occlude it. The glacial pilot keeps its water inland. Faint clustered sky points and fractional brightness replace blanket star thinning, while large decorative motes and figures recede.
