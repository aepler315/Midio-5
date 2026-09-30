Super Maudio World begins with three performers sharing a bright, playful, incomplete world. As the song gathers force, that world resolves into the vast Range landscape. Their expression passes into the ridges, land, and atmosphere as their bodies disappear. What arrives is beautiful and musically alive, but the company that made the opening warm is gone.

> Historical plan: the later [landscape performance plan](../plans/2026-09-30-landscape-performance.md) supersedes actor introduction/departure, optional gameplay presentation and the extra full-analysis wait. Current behavior and evidence are documented in [landscape performance validation](../../evidence/landscape-performance/README.md).


**Recommendation: default candidate for the Range listening experience, introduced as an opt-in pilot until visual and device validation establish that the handoff works.** This is a proposed design, not implemented behavior. The artistic interpretation comes from the supplied brief; technical findings below come from current repository source.

The design preserves the tension between fellowship and sublimity. The trio are lovable and real within their world. The landscape offers depth, scale, and transcendence while withholding the intimacy of the opening. There is no narration declaring either experience superior.

Scope: one narrative arc per song in Range, using the existing Range v2 terrain, camera travel, musical ridges, and glacial candidate where available. Other worlds and existing gameplay remain separate presentation choices for the pilot. No new terrain collection, stem separation model, biome selection policy, or glacier reconstruction is required.

## Current repository and integration constraints

Reviewed `main` at [bbe0afc](https://github.com/aepler315/Midio-5/commit/bbe0afcae722c59c774b5c7396b55cfa4342c616), the merge of #338.

| Existing system | Verified behavior | Design implication |
| - | - | - |
| [Simulation](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/sim/Simulation.js) | Resolves Midasus to a clean lane or melody, Broshi to a bass lane or melody, and Midio to a lead lane or bass. | Preserve these actual lane choices when expression moves into the world. Their names alone do not identify independent audio sources. |
| [EnsembleDirector](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/sim/EnsembleDirector.js) | Presence weights affect the trio's coupled motion; voyages and burrowing already alter presence. | Render opacity and participation in ensemble dynamics need separate controls. Calling existing presence setters once will be overwritten by excursion logic. |
| [RangeFrame](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/world/alpine/RangeFrame.js) | Builds an immutable frame with heard time, travel, music, material lighting, emitters, and glacier state. Its musical field already separates slow pressure, kick, melodic, structural, and summit responses. | Add narrative state here; extend the existing musical field rather than creating another competing terrain animator. |
| [WorldMusic](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/world/WorldMusic.js) | Samples trailing energy and bass; its existing `reveal` is a brief, confidence-weighted section-boundary envelope. | A lasting narrative reveal needs a distinct name and state. The existing `reveal` cannot serve as the whole-song arc. |
| [RangePresentation](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/world/alpine/RangePresentation.js) | Has technical arrival and incoming-view fades; export bypasses those fades. | Keep asset readiness and narrative timing independent. Narrative progression must remain present in exports. |
| [BiomeManager](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/world/BiomeManager.js) | Range v2 paints far terrain, Dancing Ridge, mid terrain, then near terrain. SpaceRidge has separate sky ownership. | Preserve depth order. Promote ridge authority through expression and composition, not by painting both lines over the entire scene. |
| [Renderer](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/render/Renderer.js) | Cast bodies can be captured for water reflections; shadows, trails, glow lights, voyages, and burrowing have additional paths. | Disappearance must cover every visible cast contribution. A body-only fade would leave accidental ghosts. |
| [FilmFinish](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/src/render/FilmFinish.js) | Calm deepens the vignette and hype opens it; the renderer can omit heavy post effects. | Narrative sky pressure needs explicit composition with this policy and a cheap essential path. Otherwise energetic music may undo the requested darkening. |
| [Glacial preview evidence](https://github.com/aepler315/Midio-5/blob/bbe0afcae722c59c774b5c7396b55cfa4342c616/docs/evidence/glacial-valley-flight/README.md) | Pend Oreille is a forced candidate, uses an artistic compressed retreat, and keeps water inland. Reported mobile residency is near the 128 MiB budget; software GL evidence does not establish hardware frame rate. | Do not force an ocean into the inland view, promote the candidate automatically, or allocate a second full landscape for the reveal. |

These findings establish useful seams for implementation. They do not establish that the proposed transition is feasible at the desired frame rate or emotionally successful.

## Approaches and selection

| Approach | Benefit | Cost or limitation | Judgment |
| - | - | - | - |
| Song-indexed accumulation with distinct visual channels and musical inheritance | Preserves loss, adapts pacing to the recording, supports seeking and export, and lets quiet passages remain meaningful. | Needs a small narrative timeline plus coordinated render controls. | Recommended. |
| Fixed elapsed-time sequence | Easy to tune and reproduce; useful as a diagnostic comparison. | A compressed song and a slow atmospheric recording receive the same emotional timing. | Keep for comparison, not the listening default. |
| Reversible energy-driven visibility | Loud and quiet passages immediately change the cast and terrain. | Characters repeatedly return; disappearance becomes a toggle and quietness can erase the revealed world. | Reject for this thesis. |

The selected approach separates **revelation**, which advances during forward listening, from **response**, which follows current musical activity. Loss persists while expression continues. Seeking backward reconstructs the earlier state; that is navigation through the piece, not a narrative reversal.

## Narrative arc

### Shared opening

The trio occupy the foreground in a bright void with a limited vocabulary of warm colors, small musical marks, and playful shared flourishes. Sparse pitch-black terrain contours already describe the geography that will later become material. The opening should feel authored and inhabited from its first frame.

Small signs of relief emerge early. Avoid a long blank prelude or a progress indicator that makes this read as asset loading. The synthetic vocabulary is expressive but limited: a few coherent families of marks, rather than a crowd of unrelated glyphs, stars, and game furniture.

### Emergence and departure

Dancing Ridge becomes the first clear bridge. Its articulation begins taking the phrases previously made legible by the performers. Relief, atmospheric separation, and material presence emerge at different rates. Familiar terrain contours persist, making the viewer recognize the same place acquiring depth.

The sky's periphery develops a restrained rhythmic pressure. Cast expression still matters as bodily presence diminishes. Their last gestures have counterparts in the receiving world; disappearance should be noticed as a change in company, not merely a cleaner composition.

### Desolate continuation

The fully present landscape becomes the principal performer. SpaceRidge gains impossible-scale authority without overwhelming Dancing Ridge or flattening terrestrial depth. Land, water, and atmosphere retain distinct responses to the song.

No permanent ghost trio follows the camera. Residual traces resolve, leaving the world populated by geography, vegetation, and musical motion rather than companions. Desolation means the loss of fellowship; it does not require barren land.

The camera continues to reveal terrain while the distant world remains beyond arrival. No summit landing, reunion, celebratory badge, or cutscene explains the meaning. The song's ending may rest or withdraw naturally without manufacturing a triumphant destination.

## Source to behavior mapping

The following rows describe proposed expressive ownership. Preserve actual casting and provenance. If two performers currently share a fallback melody source, do not invent two independent musical lines.

| Musical source | Shared opening | Emergence | Desolate continuation |
| - | - | - | - |
| Midio's resolved lead lane, or existing bass fallback | Acrobatic phrase accents and readable local gestures. | A contour gesture answers the same phrase while Midio's bodily emphasis recedes. | Dancing Ridge carries phrase articulation; qualified pitch may also shape the existing melodic terrain field. |
| Broshi's resolved bass lane, plus separately identified audible kicks | Grounded body motion, hops, and rhythmic weight. | The same bass envelope gains authority in land pressure and water continuity; a kick remains a short accent. | Low-frequency land response and appropriate water receivers carry weight without making every mountain jump together. |
| Midasus's resolved clean lane, or melody fallback | Darting, floating, and light articulation. | Her marks become a sparse atmospheric or distant-ridge response tied to the same events. | SpaceRidge and selective sky or atmospheric light carry sustained scale and clean articulation. |
| Existing seven spectral bands | Secondary graphic activity in the void and latent ridge contours. | Dancing Ridge remains spatially distributed; SpaceRidge responds more slowly. | Both keep their distinct geometries, response times, and depths. Seven bands are spectral energy, not seven identified instruments. |
| Detected structural boundary and confidence | Rare shared punctuation. | Brief acceleration of an already developing reveal and a coordinated handoff accent. | A change in expressive emphasis within the same revealed world. |
| Current energy and sustain | Immediate performer intensity and local motion. | Shape pace and material emphasis without repeatedly changing phase. | Control current land motion, water continuity, and breathing scale. |
| Silence | Pause expressive activity. | Hold accumulated revelation. | Keep the revealed geography and camera state; transient gestures settle. |

Inheritance is a transfer of **expressive emphasis**, not removal of audio events from simulation. For each actual source lane, build one heard-time envelope and give source and destination complementary emphasis weights. Keep modest ambient landscape motion underneath. A middle state must not double the same transient into two equally dominant gestures.

Use pitch only where its provenance supports it. Existing RangeFrame melody sampling distinguishes MIDI, tracked recording estimates, weaker estimates, and synthetic pitches. Extend that discipline to lane-specific sampling. When pitch is uncertain, inherit activity and phrasing without fabricated notes.

## Narrative timing and reproducibility

All values in this section are proposed initial tuning values. They define a concrete pilot; listening review may change them without changing the ownership rules.

For an analyzed finite song, build a compact prefix index at the audio curve sampling interval. Let `A(t)` be an audible-content gate, `E(t)` the existing trailing normalized energy, and `B(t)` the existing trailing bass energy. Define:

```text
w(t) = A(t) * (0.35 + 0.45 * E(t) + 0.20 * B(t))
Q(t) = integral of w from song start to t
U(t) = integral of A from song start to t
P(t) = 0.70 * Q(t) / Q(D) + 0.30 * U(t) / U(D)
r(t) = smoothstep(0.03, 0.58, P(t))
```

`D` is the analyzed duration. The nonzero audible baseline allows quiet sustained music to reveal a world. Silence contributes nothing. Normalizing by the recording's totals prevents a mastered loud track from completing the arc instantly. Energy changes local speed while audible duration prevents extremely dense passages from owning all progression.

Construct the audible gate from source energy above the recording's measured silence floor, with 250 ms hold across tiny gaps. For MIDI, use actual active notes and their release windows. Precompute that gate deterministically. Treat genuinely silent input as `P=0`; protect zero denominators. If usable curves are absent but timed notes exist, use their indexed velocity/activity to derive the same measures. With no usable music evidence, retain a quiet shared presentation rather than inventing beats. Unknown-duration live input is outside this pilot.

Detected boundaries may shift internal milestone times by at most one valid bar, or two seconds when no reliable bar grid exists. Only use an actual detected boundary inside that window; preserve ordering and interpolate smoothly around it. Inferred or decorative sections cannot force a departure. The overall start and completion limits remain unchanged.

Full-song analysis supplies normalization and pacing; individual audible gestures still evaluate only events at or before the heard frame. The schedule is compiled once from a fixed analysis result. It must not change after listening has begun because an asynchronous analysis result arrived late.

| Channel | Initial reveal interval in r | Purpose |
| - | - | - |
| Relief and stable physical form | 0.00 to 0.40 | Begin revealing early. |
| Atmospheric depth | 0.10 to 0.60 | Give the contours spatial separation. |
| Surface materials and terrain light | 0.20 to 0.75 | Establish physical specificity. |
| Water, snow, and glacier material visibility where present | 0.25 to 0.85 | Make existing features legible without introducing absent geography. |
| Broshi expressive handoff | 0.28 to 0.72 | Move bodily weight into land and water. |
| Midasus expressive handoff | 0.35 to 0.80 | Move clean articulation into distance and atmosphere. |
| Midio expressive handoff | 0.42 to 0.88 | Finish the local phrase bridge into Dancing Ridge. |
| SpaceRidge authority | 0.55 to 1.00 | Make the impossible scale a later culmination. |
| Sky darkening | 0.15 to 0.90 | Let the shared void gradually withdraw. |
| Final trace resolution | 0.78 to 1.00 | Leave a clearly companionless final state. |

Use a smoothstep per interval, not one common alpha. On an approximately steady four-minute recording, visible relief starts around seven seconds and the full desolate state arrives around 139 seconds. These are illustrative consequences of the formula, not promised timings for every song.

For clips under 30 seconds, present a compressed sketch: use the same schedule but omit residual traces and rare flourishes that cannot resolve before the end. The complete narrative is intended for normal song lengths.

Pause freezes the arc. Backward and forward seeks sample the same indexed state. Repeated draws never advance it. Restart or a new song rebuilds it. A biome change, renderer fallback, quality change, or return to Range samples the existing song position without replaying the opening. Export samples the same state as listening; export mode must not set `r=1`.

## Character disappearance and musical inheritance

For each character, derive handoff weight `h` from its interval above. The landscape's corresponding expressive emphasis rises with `h`. Body alpha initially remains strong and then becomes `1 - smoothstep(0.12, 0.85, h)`. This creates overlap while avoiding the impression that the receiving world begins only after deletion.

Body fill loses solidity first. A narrower, briefly persistent contour and one source-linked gesture remain while the person's material presence recedes. Resolve those marks into the receiving channel, with no ghost body after `r=1`. Keep identity through timing, shape, and a restrained accent inherited from the performer; do not spread their full neon colors over the landscape.

Implement traces as bounded, indexed marks derived from actual events and deterministic time. Do not use captured prior frames or history-dependent particle tails for this new narrative layer. They would make seeking and repeated export draws disagree.

Apply narrative presence to bodies, reflections, contact shadows, personal lights, brush strokes, afterimages, satellites, voyages, burrowing representations, and cast-dependent decorative figures. Ambient celestial light remains. Scale reflected alpha once, using the already faded capture or one compositing multiplier, so it neither persists at full strength nor accidentally receives a squared fade.

Keep narrative bodily presence separate from excursion presence and ensemble participation. If coupling should reflect departure, combine the narrative presence with existing excursion presence at the central resolver. Do not replace source filters or use darkness to conceal bodies that continue glowing elsewhere.

The final frame may remember the trio through the world's musical roles. It should not keep recognizable character silhouettes as permanent companions.

## Outline terrain becoming Range v2 terrain

The opening and revealed scene must use the same terrain, camera pose, deformation, glacier displacement, and occlusion. This is one geography changing its mode of appearance. Existing legacy skyline strips are useful fallback geometry but are not an acceptable opening surrogate for a different v2 scene.

Prefer sparse feature linework over rendering every triangle edge. Show silhouettes, selected ridge crests, valley turns, and a few contour hints. Dense triangulation would read as a mesh debugger and obscure the mountains.

Proposed implementation: derive a bounded set of feature paths from loaded source terrain; reference their source positions through the same GPU deformation and glacier functions used by the terrain. Use the existing depth preparation and partition order. At the opening, terrain surfaces use a void-compatible unlit appearance while selected visible paths paint pitch black. Hidden features remain occluded.

Reveal relief, atmosphere, albedo/detail, feature materials, and coherent illumination through material controls in the existing terrain pipeline. Each stage samples the same source-space geometry. Avoid temporal noise, dissolving triangles, or a screen-space wipe that changes geological features. The contour remains recognizable as surface mass emerges.

Retain readable black linework while its surrounding void is bright. As local material and sky darkening would remove that contrast, relinquish the ink to physical silhouettes and lighting. Do not make the opening outlines neon to keep them visible late.

Forest scale cues can emerge with organic materials; snow and ice retain their existing geological masks. Water remains in its established receivers and depth order. Material revelation does not alter shore elevations or create water in views without it.

Glacial retreat is a separate physical chronology. Its existing journey/retreat state continues beneath the narrative material reveal. Opening linework must describe the ice-covered surface where the current glacier state covers the bed. Do not show the bed's outline through hundreds of meters of ice or thaw the glacier solely by multiplying its presence by `r`.

The proposed feature-path extraction and material controls require performance and visual validation. Their source-code seams exist; the additional cost has not been measured.

## Sky pressure and the final musical world

Resolve narrative sky colors before building the frame's atmospheric colors and material lighting. Canvas sky, terrain air color, forest, and water should agree on the same transition. An unrelated black overlay over a bright physical sky would flatten depth.

Use a broad radial pressure field with its clearest darkening toward the periphery. Initial proposed edge opacity is `0.24 * skyDark + 0.08 * skyDark * pulse`, capped at 0.32 before composition with other vignette terms. The central field should retain landscape detail. A short heard-time kick envelope can contract the field on real accents; sustained music gets slow pressure modulation. Rhythmically dense passages should remain restrained rather than becoming full-frame flashing.

Compose this explicitly with FilmFinish. Clamp the combined edge opacity to 0.40 and prevent hype's existing opening policy from cancelling narrative darkening. Preserve other cinematography where it does not contradict the arc. Reduced flash removes the fast pulse; reduced motion removes contraction and geometry motion while keeping gradual material revelation.

Treat the base sky transition and cheap pressure field as essential narrative rendering, independent of whether heavy post effects are enabled. Decorative bloom and traces can shed first under performance pressure.

In the desolate state, retain five distinguishable behaviors: phrase articulation in Dancing Ridge, slow spectral and depth movement in SpaceRidge, bounded low-frequency land pressure, water continuity where water exists, and restrained structural changes in atmosphere or lighting. Each has a different temporal response. Their peaks should not all occur on every kick.

Keep existing camera rails and world-up as the foundation. Avoid accelerating the camera on each onset. A distant peak can remain almost fixed while nearer valley structure gradually changes; that scale difference carries the yearning. The inherited land gestures supply musical movement without turning the camera into another equalizer.

## Listening presentation and gameplay

The pilot is a Range listening presentation. Retain upload, play, pause, stop, restart, song replacement, and accessible navigation. Diagnostic seek remains available through existing controls; the seekbar need not become permanent visual furniture.

Early taps may still receive playful local feedback. Late taps should produce a restrained environmental response without respawning the trio or setting revelation progress. Tapping, scoring, or perfect timing must not be required to reach the sublime world.

Keep existing gameplay as an explicit presentation choice. Its player avatar and required hazards or timing cues must remain readable. Do not silently apply the full cast fade to a mode that still requires the user to track an invisible avatar. The listening presentation suppresses gameplay-only visual demands while retaining the source analysis and transport.

The philosophical arc remains unlabelled in the scene. No visible phase names, emotional scores, or text telling the viewer what to feel.

## Proposed component changes

| Component | Responsibility |
| - | - |
| New small narrative schedule module | Compile the prefix index and ordered milestones; sample immutable narrative channels at heard time. Keep it independent of renderer and gameplay. |
| Simulation and song setup | Own one schedule per fixed song analysis, expose presentation choice, and combine narrative and excursion presence centrally where needed. |
| RangeFrame | Carry sampled narrative channels, source-lane handoff envelopes, and consistent resolved sky state. Keep render modules from reading mutable simulation directly. |
| RangeScene and TerrainMaterial | Apply staged appearance to current terrain; share existing displacement and occlusion with outline rendering. |
| Small terrain feature-path helper | Derive and budget sparse paths from the loaded terrain without retaining a duplicate terrain mesh. |
| BiomeManager and SpaceRidge | Preserve paint order, support narrative sky/void vocabulary, and weight ridge expression without suppressing identity in quiet passages. |
| Renderer and performer capture | Apply bodily presence consistently to every cast contribution and water reflection; compose cheap narrative pressure with film finishing. |
| Diagnostics | Expose narrative progress, channel weights, source provenance, and fallback reason alongside existing Range state. |

Do not build a general-purpose cinematic graph editor, a new orchestration framework, or another audio analyzer. The pilot needs a small schedule, explicit channels, and coordinated consumers.

When v2 becomes temporarily unavailable, sample the same narrative time in a simplified legacy outline/material presentation. Retain the revealed phase and a musically responsive landscape; do not resurrect the cast as an asset-loading fallback. Context recovery resumes the same state. Record the technical reason separately.

Quality reduction sheds decorative marks, then trace detail, then optional feature paths. Preserve phase, silhouettes, principal ridge identity, and appropriate water depth. Avoid a second full-resolution landscape target solely to implement a crossfade; respect the existing residency ledger.

## Acceptance criteria and evaluation

The following are required checks for implementation. No code changes or new test runs are claimed by this design review.

1. **Persistent arc:** forward listening never reduces `r`; silence and quiet passages retain accumulated revelation. Biome changes and technical fallback do not replay the opening.

2. **Transport equivalence:** fresh seek to a time, sequential playback to that time, pause/resume, and export produce equal narrative channel values and equal outline geometry. Repeated draws cannot consume new events.

3. **Source fidelity:** each inherited channel uses the corresponding resolved source; shared fallback sources are identified. Unqualified synthetic pitch cannot drive physical melodic terrain.

4. **Visible inheritance:** a recorded transition shows at least one identifiable phrase transferring from each available distinct source to its destination. The receiving landscape remains active after bodily disappearance.

5. **Complete disappearance:** at `r=1`, cast bodies, reflections, shadows, personal lights, excursions, satellites, brush, and recognizable afterimages are absent. Intended environmental expression remains.

6. **Geographic continuity:** opening and revealed silhouettes agree under the same camera, deformation, glacier, and receiver state. Hidden contours stay hidden; no tile edges or LOD seams become the dominant linework.

7. **Final-state legibility:** Dancing Ridge and SpaceRidge retain separate depth and recognizable motion in bright, dark, calm, and dense musical passages. The scene remains more than a static landscape.

8. **Sky coherence:** sky and atmospheric colors agree; combined vignette stays within the stated cap. Reduced flash and reduced motion preserve meaning without fast pressure pulses.

9. **Controls and gameplay:** listening controls remain operable. Existing gameplay keeps required player and hazard visibility. Input performance never gates the narrative destination.

10. **Device cost:** measure real desktop and Android hardware at opening, maximum handoff overlap, final state, and biome travel. Track residency, frame timing, context loss, and fallback. Existing software GL captures cannot certify hardware smoothness.

Use a test set containing a short pop song, dense metal, long progressive material, a quiet atmospheric recording, a track with silence and an abrupt loud intro, and MIDI with genuine separate lanes. Include a source where distinct lanes are unavailable to expose invented independence.

Capture the same musical instants under three presentations: this narrative pilot, permanent cast-off, and permanently reduced cast. Use matched seed, geography, camera, and renderer quality. Include sequences around early relief, each handoff, and the final desolate state rather than isolated beauty screenshots.

Ask reviewers whether they notice company, departure, inherited expression, and the cost of arrival without being shown the thesis first. If the opening reads as loading, the departure reads as UI cleanup, or the final scene reads as inert wallpaper, the design has failed its artistic purpose even if technical tests pass.

## Strongest argument against the concept

The strongest objection is that the design imposes an irreversible story of withdrawal onto music that may be joyful, communal, cyclical, or unresolved. It also risks delaying the project's strongest landscape rendering, removing its most approachable identities, and making solitude look like an upgrade. Repeated listening could reduce a meaningful departure to a familiar intro routine.

This objection is substantial. The visualizer should not claim to diagnose the song's emotional meaning. This is an authored interpretation that users choose to inhabit. The trio must earn affection, and early terrain revelation must offer beauty before the full departure.

Permanent cast-off provides immediate scenic clarity but gives emptiness no history. Permanently reduced cast preserves companionship and interaction but keeps the landscape functioning as a stage. The narrative candidate offers a stronger complete arc when the inherited expression can actually be seen. It also has the highest coordination risk.

**Judgment: default candidate for Range listening, pending comparison and device evidence.** Begin as an opt-in pilot. If inheritance and loss are not legible in matched recordings, keep it as an alternate authored presentation and improve the handoff rather than declaring the trio disposable. Expand to other worlds only after each world has a credible destination for the cast's musical functions.
