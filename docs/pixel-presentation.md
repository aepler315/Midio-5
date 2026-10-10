# Display presentation

Display settings are available on the title screen and from **Display** during playback. Look and quality are independent:

| Setting | Behavior |
|---|---|
| Natural | Existing landscape renderer at the selected Stage resolution |
| Pixel | Compose at 320×180, nearest-neighbour presentation |
| Palette | Same grid, then Landscape32 or legacy RGB332 with Off/Subtle/Full Bayer dither |
| Auto quality | Existing governor and recovery hysteresis |
| Economy | Pin the cheapest governor rung |
| Fit | Largest aspect-preserving image with opaque black bars |
| Integer | Whole-number physical-pixel scaling; aspect-preserving downscale when smaller than the grid |

Preferences live in the versioned `smw:display:v1` record. Old `8bit` presets migrate to Pixel/Economy; `8bit-intensive` migrates to Palette/Economy/RGB332/Full. Invalid values and blocked storage use defaults. Cathode is retired; stale saved world IDs resolve to The Range, including replay and previews. Registered custom worlds still work.

`PresentingRenderer` owns the presentation boundary. Title, playback, live recording and bulk export use the same presentation profile. A non-grid pixel export reserves one 320×180 working canvas through GraphicsResidency before allocation, processes at most 57,600 pixels, then fits that finished frame into the output. The recorder samples the finished source with smoothing disabled. Natural uses the existing direct path. A tainted palette canvas falls back to Pixel and reports that status; it retries only after a new presentation generation.

The 30/60 fps cap controls title and playback drawing independently of simulation. Offline export freezes the effective quality and look, and never treats frame capture cost as governor pressure. The debug overlay reports requested/effective look, working/output sizes, quality, palette status, transform time and readback time.

Drawing returns an explicit `presented` result. Capture is nullable until a frame finishes successfully; profile/backing resets, allocation failure, context loss, released buffers and disposal invalidate readiness. Export aborts and discards the partial recording on presentation failure. Live playback keeps its audio/simulation clocks running and reports failures at bounded intervals. A successfully drawn Pixel fallback after palette taint is still a valid frame.

Title and playback keep independent phase-preserving draw deadlines. The playback HUD labels delivered presentation FPS separately from callback FPS; the governor still receives raw callback timing. Integer layout resolves both origin and scale in physical pixels, including the parent's origin and DPR, and applies the logical image dimensions through a transform to avoid CSS layout rounding at fractional DPR.

`npm run test:retro` verifies default Range v2 and explicit fallback, shader/context failures, real checkerboard raster boundaries at four DPRs, meaningful content and temporal changes, exact opaque pre-encode palettes, and export rejection. `npm run test:export` records and decodes live Pixel/Palette transitions using a generated fixture; its optional fourth argument `v2` requests and verifies the actual v2 backend. Lossy decoded frames use stated brightness/coverage tolerances for bars rather than exact palette membership. The bounded pixel browser CI job preserves diagnostic artifacts on failure.

```sh
npm test
npm run lint
npm run test:retro
node tools/palette-bench.mjs
node tools/bulk-export.mjs --help
```

The browser smoke needs an installed Playwright Chromium or `PLAYWRIGHT_CHROMIUM_PATH`. Software WebGL validates raster output and shaders; it does not establish device FPS, battery use or GPU timings. Warm palette arithmetic and browser readback measurements are recorded under `docs/evidence/pixel-storm-peaks`.
