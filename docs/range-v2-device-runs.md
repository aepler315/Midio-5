# Range v2 device runs

Task 16 of the Range v2 plan asks for real-device measurements of steady-state and cold/transition behaviour, including a 10-minute phone run. This build was developed without a physical phone or GPU: every timing measured here is from Chromium SwiftShader (software WebGL2) and is **not** a device measurement. **Device acceptance is unverified** until the runs below are done on real hardware and their reports are added to the table at the end.

## What to run

Run each on the real device, with the tab in front, the screen awake and nothing else heavy running. Warm the device for a minute first by playing any song.

| Run | Device | Length | Why |
| --- | --- | --- | --- |
| A | A mid-range Android phone (Chrome) | 10 min | Sustained phone behaviour: thermal throttling, governor rungs, residency under the mobile budget (192 MiB) |
| B | An iPhone (Safari) | 10 min | Same, on the other mobile engine |
| C | A desktop or laptop with a GPU (Chrome) | 5 min | Desktop budget (256 MiB), the 16-band travel seam at full resolution |

## How

1. **Open a fresh page** (not one that has already played a song): `https://supermaudio.com/?fpsHud=1` (v2 is the default renderer; `fpsHud=1` shows the frame rate on screen). For a legacy comparison run, add `&rangeRenderer=legacy`.
2. **Attach DevTools to the page** (while it still shows the title screen):
   - Android: connect the phone by USB with USB debugging on, open `chrome://inspect` on a desktop Chrome, and choose **inspect** under the tab.
   - iPhone: turn on Settings → Safari → Advanced → Web Inspector, connect to a Mac, and use Safari's Develop menu → the phone → the tab.
   - Desktop: press F12.
3. **Start the probe before loading the song.** In the console, paste the whole of `tools/range-device-probe.js` and press Enter. It waits for a song, so its cold-start bucket covers the song's real start (world construction, strip bakes, the first view's preparation). To change the length, edit `MINUTES = 10` near its start.
4. **Load a song of at least 4 minutes,** so it passes through several biomes and view-to-view travels. Choose the Range world if a picker asks.
5. **Leave it running.** Keep the song playing (restart it if it ends). Don't switch tabs.
6. **Save the report.** When it finishes, the probe prints one JSON report and copies it to the clipboard. Save the report as `docs/evidence/range-v2/device-<device>-<date>.json` and add a row to the results table below.

## What the report contains

| Field | Meaning |
| --- | --- |
| `gpu`, `userAgent`, `deviceMemoryGB`, `dpr` | Device, browser and GPU as the browser reports them |
| `stage`, `rangeTarget` | CSS and backing size of the stage; size of the Range render target |
| `budget` | Residency budget class chosen (`desktop` 256 MiB, `mobile` 192 MiB) |
| `coldStartCaptured` | True when the probe was running before the song loaded (otherwise `cold` is just the first 20 s it saw) |
| `songRestarts` | How many times the song was restarted during the run (the probe follows the new song) |
| `intervals.cold` | Frame intervals in the first 20 s of the song, including the frame that spans world construction |
| `intervals.steady` | Frame intervals while a single view is drawn |
| `intervals.travel` | Frame intervals while two views are composited (view-to-view travel) |
| `…medianMs / p95Ms / p99Ms / stallsOver100ms` | Frame-interval statistics per bucket (rAF to rAF, so vsync waits are included) |
| `qualityLevels` | Frames spent at each governor level (0 is the full show; see the ladder below) |
| `legacyFrames` | Frames where the Range drew legacy scenery (a view not ready, or refused room) |
| `residencyPeakMiB`, `residencyPeakByOwnerMiB` | Highest ledger ownership, recorded by the ledger whenever ownership grows (so short-lived scratch reservations count), and what owned it at that moment. `residencyPeakWindow` says where the window starts: `page load` when the probe ran before the song (so use a freshly opened page), else `probe start` |
| `overcommits`, `denials` | Ledger overcommits (should be 0) and refused reservations |
| `rangeRenderMsPerFrame`, `rangeCopyMsPerFrame` | CPU-side time per Range frame to render all its passes (far, mid, near, rock stage; both sides during a travel) and to composite them onto the stage |

## Acceptance

| Check | Pass |
| --- | --- |
| Steady playback | `steady.p95Ms` ≤ 20 on desktop; on phones the governor holds a level with `steady.p95Ms` ≤ 34 (30 fps floor) |
| Stalls | `stallsOver100ms` ≤ 1 per minute outside `cold` |
| Travels | `travel.p95Ms` within 1.5 × `steady.p95Ms` |
| Memory | `overcommits` = 0; `residencyPeakMiB` ≤ the budget |
| Fallback | `legacyFrames` is only seen at song start or a view's first appearance (a few seconds), never for a whole section |
| Oscillation | `qualityLevels` concentrated on one or two adjacent levels after the first minute (no ladder chatter) |

## Quality ladder

`PerfGovernor` owns the level (0 = full quality … 6) and its hysteresis:
- it sheds a rung after about 1 s of sustained over-budget frames;
- it recovers one after 10 clean seconds;
- a rung that fails again after recovering waits twice as long before the next try.

What the Range scene gives up at each level is defined in `src/world/alpine/RangeQuality.js`:

| Level | Foliage kept | Fog samples | Pool reflections |
| --- | --- | --- | --- |
| 0–1 | all | 6 | on |
| 2 | 85% (stable subset) | 6 | on |
| 3 | 70% | 4 | on |
| 4 | 55% | 4 | on |
| 5 | 40% | 3 | on |
| 6 | 30% | 2 | off |

At no level does the ladder touch the landform (terrain meshes and their LOD budget), ground contact, the performers or the musical signatures.

Fewer fog samples keep the frame's overall haze within 3% of full quality (`test/rangeAtmosphere.test.js`). Only where individual mist puffs fall changes.

## Results

| Date | Device / GPU | Browser | Run | Steady p95 | Travel p95 | Stalls | Peak MiB | Levels | Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | not yet run | | | | | | | | |

## Coherent terrain continuation — 2026-10-01

No current-source desktop or physical Android run was available for `codex/coherent-terrain-performance-20261001`. Hardware acceptance is **pending**; prior device results do not validate this branch. CPU geometry measurements and unit tests are not frame-time evidence. Use the procedure and gates above on the three forced candidates and ordinary approved views; see [the continuation record](evidence/terrain-continuation/README.md).
