# Range visual correction: audit and target

Audited baseline: `3231263e8d1a624f8f78421ed46ee70bc7770061` (main after PR #329), following PR #328 (`e4a0e81`). The supplied `ChatGPT Image Sep 25, 2026, 09_18_47 PM.png` was inspected locally. It is feedback, not a public repository asset. Fresh Chrome captures of baseline are retained separately from candidate captures.

## Intent and history

The Range is a musical landscape, not an exercise in uniformly quiet ambience. SpaceRidge's source describes a massive, distant, megalophobic third equalizer. The horizon EQ carries a famous scanned skyline; scenic L2-L4 carry separate real ranges; the ground and performers carry the playable world. PRs #315-320 established that geography, distinct ranges and musical motion. #326 removed broad glare and attempted to open skylines. #328 added deterministic source-space materials, valley fog and ground response. #329 repaired opacity propagation and palette ownership, but both PR descriptions explicitly left visual acceptance unfinished.

There were competing decisions before those two PRs: SpaceRidge's vertical response had been reduced to residual shimmer, while moon approach, star visibility and constellation readability were enlarged independently. The newest parameter values are not the specification.

## Supplied frame

The active frame is approximately x=174..1428, y=0..707 in the supplied 1536x709 image. The bright moon is the first sky focal point, followed by the constellation network. The distinctive cosmic ridge is not readable as a structure. Tiny orbit rings, many stars and incidental marks survive. The broad olive ridge begins around y=205 at its central crest and spans virtually the entire width, with a largely empty face extending toward y=390. Its total body continues behind the front layers. Its apparent material is smooth and almost uniformly valued. This is an approximate visual measurement, not an identification of the exact source range from pixels.

The foreground creates another broad brown band. The characters have strong local contrast but the terrain behind them has little depth hierarchy. Pale, smooth distant forms at the ocean horizon do not contribute enough shape to justify their contrast. Negative space exists in the sky, but small marks occupy it everywhere. The musical horizon survives only as fragments. The earth is more coherent than the old stripe treatment, and the dark footing is useful, but large low-information silhouettes plus similar olive/tan values make the scene read as cutout layers. Adding texture alone cannot correct that composition.

## Evidence and root causes

1. **Signature attenuation.** `VisualStyle.spaceRidgeAlpha=.55`, `resolveRangePresentation().spaceRidge=.20*ambientScale`, then SpaceRidge's ordinary core `.14` yield `.0154` before focus/voyage/reduced-flash multipliers. Ghosts fall to `.00154`. The signature is classified as ambient in multiple owners. In contrast, the star catalogue has 2,800 stars and house ambient 1.6; live constellation edges can reach .09; ensemble bodies reach .27. The live/fading/retained constellation populations exceed the apparent holding-figure cap.
2. **Insufficient form.** SpaceRidge sits at .19H with only .03H band throw and .012H tidal drift. Its depth changes horizontal spread and width more than its vertical silhouette. Raising opacity alone would expose a small decorative line. Preserve distant slow movement and celestial occlusion, but revise the scale of the form.
3. **Dead accent.** SpaceRidge detects a flash from a smoothed *single-step* increase >.35. At 120Hz and fastest .05s attack the largest possible increase is .1535. Its test uses .1s. A real onset must work at the actual simulation cadence and re-arm after release.
4. **Unmeasured occlusion.** `chooseBiomeRidges` filters only the near candidate through coarse whole-scan `WALL_SHARE`. Middle candidates are unfiltered. `_rangeDh` caps L3/L4 height but does not measure local contour information or coincident sightlines. `anchoredFarDrawHeight` compares global crest averages, not viewport masks. On the overscanned 1408x848 stage, nominal L3 and L2 skyline envelopes overlap by about 114px. The horizon EQ and massif draw before all scenic strips, which can erase them.
5. **Facet contrast overwritten.** `resolveFacetTone` returns a directional accent capped at .08, but `drawRidgeSurface` divides it by .08. A centered-light example paints opposing faces with the same accent color at .746 opacity, reducing a base RGB separation [33,35,31] to [8,9,8]. The tests only check helper colors, not the composite.
6. **Gully alpha leak, confirmed.** The last facet leaves `globalAlpha` changed. Gullies encode inherited opacity in rgba and then inherit that canvas alpha again. Polygon canopy resets alpha and does not share this particular bug. Primitive opacity must have one owner.
7. **Tiled material loss.** Selection compares local descriptors to an absolute source window; tile offsets are applied only after selection. A second procedural tile can contain no selected material even though its copy is visible. Clip/select in matching coordinates and preserve budgets across copies.
8. **A/B translucency.** Full-opacity side rendering is sound; sequential source-over blits at 1-a and a are not an opaque crossfade. At a=.5 two opaque sides total .75 alpha and leak the background. Use premultiplied side combination, then composite once.
9. **Palette/feature flattening.** Source-in recoloring replaces all baked RGB, including landmark detail, and long-slope material panels are disconnected quadrilaterals. Ground patches correctly follow the rendered curve but are small and shallow. Preserve curve attachment and restrained soil; repair face structure first, then judge whether ground changes are necessary from the final image.
10. **Evidence harness is not an acceptance test.** Range IDs are read as `range.far.range.id`, though the actual contract is `range.far.id`. The URL seed targets an absent input, so recorded requested and actual song seeds differ. Visibility preset entries all render 45s, omit station from case names and overwrite captures. Several named presets are aliases with no meaningful setup. Served identity compares locally invented SHA values with empty hash maps. Fix these before making acceptance claims.

## Complete render trace

| System | Path and outcome at baseline |
| --- | --- |
| A SpaceRidge | Simulation update -> `SpaceRidge.update` -> Range style/presentation -> draw before celestial; multiplied into invisibility, transient detection dead at 120Hz. |
| B stars/constellations | `_drawSky/_drawStarfield` catalogue, `drawDeepSky` authored voyage, `weaver.draw` live/retained figures; independent populations and inconsistent hierarchy. |
| C ensemble | `SkyEnsemble.draw` A/B planets and artifacts in same upper band; one planet per side can mean two in transition. |
| D celestial/beams | `dayNight` -> celestial approach/moon/sun -> shared physical light; opaque bodies correctly occlude deep sky. LightRig has count reduction plus presentation dimming. Prefer explicit optional-event exclusion. |
| E musical horizons | `_drawHorizonEQ` uses scanned crest and bands; `_drawSpectrumMassif` uses another summit. Both precede scenic strips; no actual visibility contract. |
| F scenic L2-L5 | biome ranges -> full-profile normalization -> 8192px strips -> travel/height fit -> dancing blit and `_crestPoints`; source topology is useful, current composition fit is insufficient. |
| G materials | `buildRidgeSurface` source descriptors -> clipped live crest projection -> facet, gully, cover -> side canvas; contrast, alpha and tile selection bugs above. |
| H ground | fixed ground transform -> light-space conversion -> palette base/depth -> curve-bound patches/scatter -> characters/contact/response. Preserve this foundation. |
| I ocean | opaque backing, body, 3-8 contour rows, reflected sky/light and events -> horizon geometry -> scenic occlusion. Not the primary source of the flat mountain wall. |
| J final image | world/characters -> veil -> motion blur -> bloom -> heat -> soft-light grade/space wash/vignette -> HUD. Film diagnostic gate currently misses the space wash and vignette; repair isolation before comparing passes. |

## Target and choices

The musical horizon is the hero land silhouette. L2 provides recognizable geological mass and L3-L5 provide increasingly close, darker, smaller supporting forms. A high smooth viewport must settle lower rather than becoming a wall. Preserve scan x coordinates and relative crest topology; use a shared foot-anchored fit, with no invented connector hills. Broad foreground bodies should ordinarily stay below about a fifth of visible screen area each. Target at least 55% exposed musical horizon and useful continuous runs, and at least 55% exposed L2 against nearer scenery, measured on the actual capture cases rather than inferred from configured height.

SpaceRidge is the main upper-sky musical geometry: a frame-spanning, slow, distant articulated form, readable in day and night. It lives behind the celestial and above the land. It should occupy enough vertical extent to imply volume and immense distance while leaving clear sky between its major contours and the land. Ordinary stars avoid its corridor; at most one incidental constellation/secondary idea competes at a time, with authored voyage/event priority. Sparse retained points are preferable to a full-screen network. Reduced flashes reduces transients rather than erasing the steady signature.

Material faces must retain intrinsic light/shade separation under centered or absent light; directional light adds a small accent. Canopy forms connected masses attached to the source. Dry biomes retain mineral structure without acquiring forest or wet features. Three depth/value groups should read at playback size, without horizontal stripe clutter or full-screen fog.

A pure opacity reversal was rejected because it leaves the wall, small cosmic geometry, and material bugs. A wholesale revert was rejected because it destroys source-space, A/B, light-space and deterministic engineering. The selected approach corrects composition and contracts inside the existing renderer.

## Acceptance

Compare the same fixture against the saved main snapshot. Inspect all eleven biome frames, explicit bright/day and dark/night cases, at least three A/B seam positions, a broad real profile, SpaceRidge isolation/absence comparison, and 21 distinct travel stations. Inspect motion and reduced-flash/low-quality cases. Manifest actual seed/time/ranges/viewport/quality and hashes of served modules. No missing fixture may silently substitute the home range. Tests cover mechanics; inspected images decide art acceptance.
