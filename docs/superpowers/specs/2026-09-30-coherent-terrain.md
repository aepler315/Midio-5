# Midio-5 terrain evaluation and direction

**Recommendation:** keep Range v2 and make its existing landscape behave as one coherent musical scene. The next investment should be composition, reliable time reconstruction, and perceptible musical expression across the terrain already shipped.

Reviewed September 30, 2026, Pacific time. Repository baseline: [`c7c22e850a92bdea6313653ab03903f587e03e28`](https://github.com/aepler315/Midio-5/commit/c7c22e850a92bdea6313653ab03903f587e03e28), current `main` when this review began. This evaluation accompanies `midio-5-terrain-implementation-plan.md`. It is a plan and source review, not a claim that the proposed changes have been implemented.

## Verdict

The terrain addition is a substantial improvement in the underlying visual language. Real mountain relief, branching slopes, forests, and water supply the scale that the older scenic strips could not. The historical production captures show recognizable terrain with convincing large forms; the trees do useful work as scale references. Replacing this renderer would discard useful work.

The remaining weakness is how the pieces compose and perform together. The realistic terrain, luminous musical ridges, legacy foreground footing, and latest cartoon shore overlay follow different visual rules. Some of those layers conceal others. Musical motion exists, but the historical dense far-crest measurement improved only from 2 to 3 screen pixels. That can still feel static beside the much more expressive luminous ridge.

The artistic direction should be **a vast landscape that performs the song**: fast articulation in Dancing Ridge, slower mass and spectral response in SpaceRidge, bass pressure through terrain flanks, stable water receivers, and deliberate camera travel that reveals scale. Quiet passages should remain spacious; dense passages should become more legible and consequential without making every feature bounce together.

## What the recent additions actually contain

| Work | Current state | Implication |
|---|---|---|
| Range v2, PRs #332–336 | Real DEM terrain, material packs, forest attachment, GPU partitions, scene selection, resource accounting and legacy fallback are shipped. Catalog contains 13 approved views and the Pend Oreille candidate. | Preserve this architecture and existing catalog. |
| Audio and motion, #337 | Terrain already has bass, kick, melody, structural and summit channels. Camera travel already uses heard time and an energy integral. | Do not start another terrain animator or camera clock. |
| Glacial flight, #338 | Pend Oreille remains a forced candidate; it is not part of normal approved selection. | Keep it available as a stress case while the ordinary landscape improves. |
| Revelation, #340, followed by #341 | #341 superseded the default presentation with landscapes from the opening, immutable ridge history, stronger motion, relational moon movement and coherent lighting. | Do not reintroduce a delayed reveal arc as part of this plan. |
| Inhabited shore, #342 | Three small residents and an opaque beach/sea overlay were added for every alpine view. | This conflicts with the latest explicit actor-free direction available for this review. Treat default resident removal as a recommendation grounded in that direction, not as proof of the author's intent for #342. |

The requested 2–5× ridge travel is already represented by source-specific 2×/3× factors. Adding another blanket multiplier would compound it. Shared celestial lighting and vegetation-aware solar scattering are also present already.

## Findings that should determine the next work

### 1. The latest sea overlay covers the terrain it is meant to improve

`LandscapePresentation.js:5` enables `inhabitants:true`; `Renderer.js:365,388–418` activates and paints the new shore in every alpine scene. `InhabitedShore.js:20,54–73,190–229` creates its shoreline around two-thirds frame height. This is a screen-space construction, independent of the selected view's actual lakes, rivers, or dry ground.

The pass runs after scenic terrain and the rock stage. It therefore covers roughly the bottom third while those underlying GPU passes still run. It also applies to the inland glacial candidate. The exported `SKY_BOTTOM_FRAC` constant does not refit the mountains or establish a complete three-part composition.

**Decision:** remove the unconditional resident/sea pass from default listening. Preserve appropriate distant ocean in existing non-glacial compositions and improve the real lake/river receivers. Keep the inland candidate inland and dry terrain dry. This is a focused correction, not a wholesale revert of #341 or the terrain pipeline.

### 2. Seeking can change the Dancing Ridge's shape at the same song instant

The canonical musical history is sound, but the rendered ridge still takes spectrum advection from `pose.worldX`. `Simulation.js:169,259–277,375` initializes, resets, and integrates that value. `RangeFrame.js:241–243` supplies it to `RidgeMotion.js:41`.

A fresh simulation seek has a different accumulated world travel than sequential playback. The current test at `test/ridgeMotionHistory.test.js:138–142` overrides both with the same `worldX:80`, hiding the dependency.

**Independently reproduced:** a 12-second, 50 Hz synthetic source with bands `[.9,.05,.05,.05,.05,.05,.05]`, RMS `.01`, seed 45, and no note events produces world positions 882.2 versus 0 at heard time 4000 ms. Using each simulation's actual `lerpState(1)`, the maximum Dancing Ridge point-height difference is **261.961 logical pixels**. This is a production geometry measurement, not a screenshot difference or a claim about every source crest.

**Decision:** give musical band advection a song-owned heard-time phase. Preserve unrelated simulation travel. Test through real poses, actual seek paths, analysis adoption, and export.

### 3. Terrain can abruptly return to neutral when raw activity reaches zero

`RangeFrame.js:107–119` turns raw activity into a binary multiplier for every deformation channel. Its filtered bass pressure can remain elevated while that multiplier becomes zero.

**Independently reproduced:** bands `.8` and physical RMS `.01` through the first second, followed by silence, retain bass pressure `.6667` across 999.9 → 1000 ms. Yet `amplitudeM` changes from 22.833 to 0. At one sampled source-space point, deformation changes from 18.885 m to 0. Rendered severity remains unmeasured.

**Decision:** add a causal release envelope to the existing immutable history. Silence should let existing pressure settle; it must not start motion from an initially silent source. Removing the activity gate without replacement would expose the envelope's nonzero resting floors.

### 4. Musical motion needs calibration against visible output

`rangeMusicState()` and `calibrateRangeMusic()` already implement distinct channels and an 8–20 nominal pixel target, bounded by 180 m and 6.5% of source relief. The historical production report explicitly says the measured distant crest moved only 2 → 3 pixels. A target in a formula is not a measured result.

**Decision:** measure visible terrain anchors at fixed camera positions before tuning. Give bass weight to visible flanks and near/mid features, keep distant summits restrained, and preserve attached forest roots, normals, and water pinning. Improve framing before raising geological caps. The Dancing Ridge remains the fast, high-amplitude musical voice.

### 5. The foreground still carries the old performer's stage vocabulary

`RockStage.js` builds four slate-like slabs from the former walking support curve. In inspected #341 stills, the lower foreground reads as repeated dark bands. The later sea covers these bands without resolving their geometry or cost.

**Decision:** use a shallow, view-specific near ledge only where it contributes depth. Remove broad stacked full-width edges. Where the scenic terrain fills the frame, omit the artificial footing and release its unused render target. Do not expose blank canvas by merely masking the old stage; validate lower-frame coverage first.

### 6. Water and aspect handling need targeted visual checks

The actual terrain water shader currently mixes strong horizon-sky reflection with a narrow celestial glint (`TerrainMaterial.js:301–307`). The inspected historical Teton day/moon images show broad pale lake areas that compete with the mountain mass. This is a tuning opportunity, not a demonstrated new #342 regression.

The historical portrait export also stretches the moon and terrain. Production phones are expected to show a letterboxed 16:9 stage, while that smoke requested a 540×960 export. Those are different products and should be verified separately.

**Decision:** tune natural water color, reflection mix and glint first, retaining source masks and shared light. Preserve 16:9 phone letterboxing. For arbitrary portrait exports, fit the existing stage uniformly rather than stretching its axes; custom portrait cinematography can be a later feature.

## Choice of direction

| Direction | Benefit | Cost or limitation | Recommendation |
|---|---|---|---|
| Consolidate terrain as the musical performer | Builds directly on shipped systems; addresses composition and timing defects; makes existing assets more valuable. | Requires moving evidence and careful tuning. | **Choose this now.** |
| Expand the catalog or add more effects | More variety and novelty. | Does not fix current layering, seek divergence, or weak projected response. | Defer until the existing views work consistently. |
| Develop a shared-world narrative or resident shore | Offers a different emotional/storytelling interpretation. | Reopens cast policy and competes with the latest actor-free direction. | Outside this implementation plan. |

## Design brief for implementation

1. Default listening is actor-free from time zero, including fallback and export. Existing Cathode boss identity remains separate.
2. Retain source history → pure ridge samples → immutable RangeFrame → shared deformation/lighting as the rendering contract.
3. Distinguish five temporal roles: phrase articulation, slow cosmic ridge mass, bass terrain pressure, slow camera exploration, and appropriate water response. Do not route every channel to the same kick.
4. Preserve existing source-specific 2×/3× ridge speed, hydro pinning, geological deformation ceilings, layer order, earned chapter policy, fallback, and resource budgets.
5. Initial art pilots: Teton Jackson Lake, Monument Valley, and Pend Oreille as an explicitly forced candidate. Ross Lake is the main regression view.
6. Water belongs to its geography. No universal bottom-third sea; no invented lake in a dry view; no ocean inserted into the inland glacial pilot.
7. First-pass foreground: at most 12% of nominal frame height in the three pilots, using a short ledge or none. This is a proposed design limit to test, not a current measurement. Extend it only after checking full-frame coverage and transitions.
8. Keep the existing camera rails and world-up. Author rail/FOV adjustments to reveal valley depth; do not make camera speed an equalizer.
9. Do not add new terrain assets, stem separation, a second motion authority, a second full-resolution landscape, or a general cinematic editor.
10. Success requires current-source moving clips and hardware measurements. Still images, synthetic audio, and passing unit tests each establish only part of the result.

## Verification performed in this review

- **201 focused current-head tests passed**, zero failures and skips: presentation, shore helpers, ridge history/composition, Range frame/quality/lifecycle/transition/framing, narrative, terrain materials/cache, assets and shader-source checks. Lifecycle coverage here includes mocks and does not prove physical context recovery.
- Runtime verification passed committed vendor and terrain/material hashes for **all 14 catalog entries**. It reported `rebuilt:false`; no dependency-based bundle rebuild was performed.
- Both timing defects above were reproduced using production functions. No production code was changed.
- Inspected historical production day/moon images and the validation reports. No new browser render of #342 was captured: this workspace has no installed Chromium binary. Current visual appearance and device speed remain unverified.
- Historical #341-era RTX 3060 measurements exist: steady p95 17.2–17.4 ms and controlled travel 17.3 ms. They identify exact earlier source bytes and do not certify #342. Android hardware and the held-out real-song artistic matrix remain missing.

## Source entry points

- [Current presentation policy](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/src/world/LandscapePresentation.js)
- [Final compositor](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/src/render/Renderer.js)
- [Added shore](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/src/world/InhabitedShore.js)
- [Range frame and deformation](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/src/world/alpine/RangeFrame.js)
- [Musical ridge sampling](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/src/world/alpine/RidgeMotion.js)
- [Historical visual and validation evidence](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/docs/evidence/landscape-performance/README.md)
- [Historical desktop timing](https://github.com/aepler315/Midio-5/blob/c7c22e850a92bdea6313653ab03903f587e03e28/docs/evidence/landscape-performance/live-performance.md)
