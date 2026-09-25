# Range landscape candidate: validation record

Base: `cb56501` (PR #327, after the audited terrain commit `8db7392`).

## Implemented

- Alpine-only cover/depth/quality policy for all eleven real biomes and a dry custom fallback.
- Distinct colors baked into the actual L2–L5 strips; ordinary alpine wire and baked edge-light removed. The dedicated horizon EQ and its timing remain unchanged.
- Deterministic inferred facets, gullies, canopy stands and valley anchors from the fitted strip skyline. Live rendering projects them through `_crestPoints` into the existing clipped body. Each A/B travel side owns its own strip metadata.
- Alpine connector infill and replacement distant-wave painting disabled. Distant-wave occlusion measurement still runs. Full-frame alpine haze and fog-bank paint replaced with small valley patches; other worlds retain their existing paths.
- Forest stand painters use filled crowns. Ground patches use the existing rendered curve and never alter physics. Ground scatter gets biome vocabulary and bounded depth-lane candidate search on long travel.
- Bounded local receiver-edge light and small clipped pool ripples after characters, derived from recent conductor events by time so backward seeks recompute the same response. Detailed character mesh reflections are omitted; composited-canvas crops include unrelated scenery and no isolated character surface fits the present pass contract.
- The old row-sliced shimmer does not run on alpine scenic strips because it bypasses live material projection; other worlds retain it. Dry biomes retain their distinct material and palette but this specific heat-shimmer treatment needs a material-aware replacement if visual review calls for it.

## Verification available in this environment

`npm test`, `npm run lint`, and `npm run stage:site` passed after the changes. Pure geometry tests cover flat/long strips, deterministic IDs, late-window cover, source projection, dry materials, reduced-flash envelopes, cache accounting and long-travel scatter.

Browser acceptance is **incomplete**. Playwright Chromium is absent; `npx playwright install chromium` repeatedly downloaded a zero-length/invalid archive from the CDN, and `tools/range-landscape-smoke.mjs` exits at browser launch. No baseline/final PNGs, per-pass pixel captures, 10-second motion clip, transition matrix, device DPR comparison or measured p50/p95 Canvas draw times exist yet. No visual quality or frame-rate claim follows from Node tests.

## Next visual pass

On a machine with Chromium: start `npm start`, then run `node tools/range-landscape-smoke.mjs http://127.0.0.1:8080 .smoke/range-landscape candidate`. Its manifest notes biomes not available in a given synthetic song cast; vary the fixture/seed until all eleven have real range IDs. Capture the corresponding baseline from the audited revision with the same synthetic fixture and harness. Review the three-plane depth, shade alignment during fractional scroll, rainforest cover density, snow permissions, fog location, ground patches and non-alpine worlds before treating this as release-ready. Run the existing `test:worlds`, `test:shading`, `test:lighting`, and `test:seek` browser suites.

The harness includes wire/fog/connector suppression frames, but does not yet isolate each scenic layer, ground, horizon EQ or ocean seam; motion video also remains open. The plan's 21-station occlusion report, device performance matrix and landscape-specific tuning remain open. This is a draft implementation candidate.
