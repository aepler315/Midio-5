# Moonlit journey overhaul

The user wants a plausible imagined landscape with genuine lateral travel, a lake that smoothly reshapes with the background, the massif as a second range behind the first, and residents that move through the scene. The previous fixed geographic cove and amplified idle poses did not achieve that. Keep sunset → moonlight → sunrise, dense twinkling stars, constellation art and musical response.

The new default performance composition is a continuous 3D valley. A foreground bank, lake, first mountain range and distant massif share one procedural coordinate field. Lateral travel moves that field through the camera; different depths create parallax. Both shore boundaries and their terrain are generated from the same continuous functions. Retain real-scene landscape mode as a separate existing path.

Use a compact render graph: directional sky, one half-size reflection, one transparent terrain/water/resident composition. No terrain package streaming, scene handoff seams, depth partitions or CPU skyline readback are needed for this imagined world. Reuse the trio's retained 3D glyph meshes with larger paths and visible locomotion. Keep export, held time, reverse seeking, reduced motion, reduced flash and context recovery.

1. Build continuous terrain and shoreline functions with CPU/GLSL agreement, a bounded second-range spectral response, and deterministic lateral travel.
2. Add causal, continuously sampled music envelopes to the existing song-owned history. Do not directly multiply large movements by hard audibility gates or instantaneous lane changes.
3. Build traveling trio poses and leg/stride articulation, using the foreground's own ground height. The swimmer remains inside both shores; the flying resident has altitude and orbiting companions.
4. Implement and integrate the lightweight journey scene as the default performance path. Preserve the existing geographic renderer for landscape mode and deliberate named-view choices.
5. Review actual 30 fps animation with synchronized audio, compare render cost/draw count, verify shoreline agreement and smooth signals, run relevant and full checks, and publish a draft PR with evidence. Hardware frame rate cannot be inferred from software WebGL alone.

Default travel is continuous through new terrain unless the user's pending preference chooses slow reversal. Visual acceptance is broad coherent travel, legible character locomotion, distinct overlapping ranges, seamless water edges and smooth motion at normal playback cadence. Numerical pixel deltas alone do not establish success.

## Implemented and verified

Auto performance uses the imagined valley; explicit geographic views and landscape mode retain their existing path. Broshi plants his feet on the scrolling bank, Midio swims with a directional wake, and Midasus flies with orbiting companions. Musical history supplies continuous source/pitch release and kick response. Listener zoom retains terrain clearance. The directional sky also fixes antialiasing across the azimuth wrap, eliminating the white seam that appeared in its reflection.

Validation on 2026-10-06:

- Full Node suite: 3,861 tests passed. Targeted routing/camera and sky tests passed after the final small changes; ESLint and site staging passed.
- `node tools/journey-evidence.mjs`: 150 actual player frames at 30 fps, with sunset, moonlight and sunrise stills. Backward seek, identical held-frame pixels, reduced motion and WebGL context recovery passed without page/shader errors.
- Separate browser check at 360×640: reduced flash preserves spatial poses; song reload retains one journey geometry owner and retags it to the new generation.
- CPU/GLSL world checks: 300 WebGL2 transform-feedback samples, with a 0.021 m maximum discrepancy at the preview time and under 0.05 m shoreline discrepancy through the long-seek probes.
- Independent review caught a missing listener-camera transform; it was fixed and regression tested.

| Render workload | Previous cove | Traveling valley |
| --- | ---: | ---: |
| Submissions per frame | 12 | 3 |
| Draw calls | 114 | 24 |
| Triangles across all passes | 6,862,788 | 187,427 |

The animation preview pairs seconds 28–33 of the generated pilot track with its matching frames. Capture used Chromium software WebGL; the exported 30 fps cadence is not a hardware frame-rate measurement. Raw captures and local MP4/GIF evidence remain under the ignored `.smoke/journey/` directory.
