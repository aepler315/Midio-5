# Midio version browser

Status: design handoff only. Implementer: GPT-6.1 Sol. No application changes or further rollback are part of writing this document.

## Intent and baseline

The user rejected the circular/spherical Journey work, requested a rollback, then interrupted a proposed deeper rollback to ask for a large back arrow at the top left and a large forward arrow at the top right. Both must disappear with the HUD and let the user surf versions. The latest instruction is to prepare an execution plan for 6.1 Sol.

Keep production at its current visual baseline while adding version browsing. At planning time, main is `a47b5b32e63da4fbfa5e2c003dcef26ed16cd453` (PR #403), whose tree exactly matches #399. The proposed rollback to #391 was never performed. Refresh main before implementation; do not restore an older main over unrelated changes.

The comparison must actually run historical builds, not change a label, swap screenshots, redirect to GitHub source, or approximate older appearances with parameters in the current renderer. Browsing is local to the visitor and never writes GitHub refs.

## Experience

- Left means the previous, older visual checkpoint; right means the next, newer checkpoint. No wrapping at the ends. A disabled endpoint remains visible while the HUD is visible.
- Use 64 × 64 CSS-pixel buttons on desktop and at least 52 × 52 on narrow screens, with clear arrow icons, accessible names, visible focus, and safe-area insets. Reserve room so they do not cover BT, playback, recording, or fullscreen controls. Allow the existing controls to wrap below the arrow row on narrow screens.
- Place controls within the existing HUD lifecycle. They fade after its existing three-second timeout, wake with it, and have no pointer or keyboard activation while hidden. The first tap on a faded screen only wakes the HUD. A focused navigation control holds the HUD open until focus leaves. Do not add a separate fade timer.
- A compact central label names the checkpoint and marks the live version. It fades with the HUD. The full commit belongs in a tooltip or details, not the main label. Include a small "Return to live" action on archived pages so a direct archive link is not a trap.
- Navigation is usable before a song loads, with the same controls shown on the title screen. During playback, all navigation chrome follows the HUD. It is DOM chrome and never enters recorded/exported video pixels.
- Switching shows the target name and loading status. Prevent duplicate requests while a switch is being prepared. Do not claim instant or uninterrupted playback: an older engine may need to analyze the song again.
- Carry the successfully loaded local audio file or ordered stem files, song seed, world/range selection when supported, heard position, pause state, and compatible display/accessibility settings. Use each version's normal load/analysis path. Do not force a newer analysis object or renderer into an older engine.
- Restore the transport position before the destination's first audible playback, then attempt resume. If the browser blocks audio initialization or playback, show one clear Resume control that retries from a real gesture. A paused source remains paused. Loading time does not advance the preserved position; a brief burst from the song's beginning is a failure.
- While recording, exporting, calibrating, or replacing/analyzing a song, navigation is disabled with a brief reason. Never drop a recording or navigate using the previous song during a replacement load.
- A title screen with no song can navigate without a handoff. For unsupported sources or settings, explain what cannot carry over; never substitute an unrelated previously loaded file. Do not silently launch the demo instead of a failed restore.

## Initial checkpoint catalog

This is a bounded first release covering meaningful visual changes, not every repository commit. The two rejected circular versions remain available for comparison. Keep the following order even though the live branch was rolled back.

| ID | Display name | Source PR | Immutable source commit |
| --- | --- | --- | --- |
| `glacial-flight` | Glacial valley | #338 | `bbe0afcae722c59c774b5c7396b55cfa4342c616` |
| `range-before-journey` | Original Range | #391 | `7383b3b34c4f5e1f3cf062fb6078178aaa24a0b6` |
| `moonlit-cove` | Moonlit cove | #396 | `70c9cb8f8fa1aae40a51060b1d2f132af9ee5ca4` |
| `traveling-valley` | Traveling valley | #397 | `316e50ea1db66c185d194f511a8a1cc62bb7a936` |
| `detailed-valley` | Detailed valley | #398 | `be8d0c4c0bd33e3839ba2a8b6f154a9e38e0ebef` |
| `natural-valley` | Mountain valley | #399 | `7557f85bae8e4f7d61f5fd9d8d628d52c052565c` |
| `circular-world` | Circular world | #400 | `4c61f72d4cb782822fcabf5d2b1c8e785cc13e16` |
| `spherical-world` | Curved landscape | #402 | `a901332676557d33536d2cbbd1e1a4da9de4a4ca` |

Initially `natural-valley` is the live entry served at the site root. Its archived source identifies the visual checkpoint, while the manifest separately records the current build SHA. Do not duplicate #403 as another visually identical stop. Right from live goes to #400, then #402; left goes to #398. If production has materially changed before implementation, reconcile the live entry explicitly rather than silently mislabel it.

## Hosting and source fidelity

Use independent static snapshot directories under `versions/<id>/`, hosted on the same origin as the live app. Use full-page navigation. This preserves each engine's HTML, module graph, workers, assets, CSS, and relative URL behavior, and ensures only one app is running.

Stage only `index.html`, `src/`, and the public `soundfonts/` contract from each pinned revision. Root-only files such as CNAME and .nojekyll stay at the site root. Never publish repository internals, node_modules, tools, tests, evidence videos, local files, or docs as snapshot runtime content.

The initial eight public trees total approximately 711.1 MiB by summing tracked blob sizes (the live #399 entry replaces one archive copy). #338 is about 35.3 MiB; the other entries are about 96.5 MiB each. Set a hard project budget of 800 MiB (838860800 bytes) for the complete staged site. Count all output files, including the live build, navigator and manifest. Do not silently drop a checkpoint when the budget is exceeded.

Full copies are deliberately the first implementation: they avoid rewriting module/asset resolution and introducing a service worker or iframe host. Build artifacts are generated from Git; do not commit hundreds of megabytes of copied snapshots. The browser fetches only the selected build's requested resources, not the entire archive. Do not preload complete versions.

The official [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), checked October 6, 2026, specify a 1 GB published-site limit and a 10-minute deployment timeout. Verify the actual artifact and deployment duration. Future catalog expansion must fit the budget or be a separately tested hosting/deduplication change.

Historical staging may apply only documented compatibility changes for navigation: navigator bootstrap/style, a narrow session adapter in main.js, HUD focus/hidden-state handling, necessary site-base metadata, and archive analysis-cache namespacing. Keep historical rendering and audio/analysis algorithms intact. Patches are selected by exact source SHA, require exact anchor counts, and fail closed on mismatch. Record original and emitted hashes plus each transformation. An unchanged file must remain byte-identical to its pinned source. Do not call the adapted whole tree byte-identical.

Give each archive's analysis cache a checkpoint-specific database name so incompatible or unversioned historical cache content cannot contaminate the live engine. The shared handoff store is separate. Audit other persistent store schemas during adapter work; never let an archive migrate/delete the live library or settings databases. Transfer only the explicitly supported preferences through the adapter.

Keep `/` and project-subpath hosting working. Each page gets trusted build-generated metadata containing its checkpoint, the shared navigator/module location and the site root. Resolve all navigation against that root, using only catalog entries. Do not accept arbitrary commit/path/URL input from query parameters. A failed manifest fetch leaves normal playback working.

## Song handoff

Use a small versioned IndexedDB store for temporary raw `File[]` data and handoff records, with a random per-tab token in sessionStorage. Preserve filenames, order, MIME types and lastModified values. Never put audio in a URL or localStorage; never upload it. Store only the last successful source for that tab, not a history of songs. Expire unused records after 24 hours and clean stale records at startup. Tab tokens and switch tokens must prevent one tab from consuming another tab's pending navigation. Duplicating a tab can copy sessionStorage: use an active owner lease and fresh document identity, detect copied tokens, and rotate the duplicate's identity before accepting a pending handoff. Release/reacquire ownership across pagehide/pageshow; do not assume sessionStorage alone establishes ownership.

Write the file payload lazily before the first switch, await transaction completion, then pause/capture the final transport state and write the small handoff record. Reuse the same source payload on later switches until the song changes. Preflight the destination before leaving. If persistence or preflight fails, stay on the current page, restore its previous play state, and show a retryable message. Do not strand the user on an empty archive page.

On the destination, initialize the adapter, consume only a pending handoff addressed to this checkpoint, and run the normal audio load path with a generation-bound restore intent. Apply seed/world/position before the first playback in the successful-start path, hold transport paused while settling, verify position within 100 ms of the saved value, then apply the user's saved pause/resume state. Measure this tolerance before the resumed clock advances, not after an arbitrary wait while audio runs. Keep failed handoffs available for retry or return to live. Complete the pending switch only after successful restoration, retaining a small latest-session record for reload and Back/Forward within this comparison session. Handle `pageshow` and the back-forward cache explicitly: do not run two loads, resurrect an older source, or create automatic-navigation loops.

The adapter owns exact app access; navigator code must not scrape file inputs or parse the pause icon. Existing `window.__SMW` is useful for test evidence but is not a sufficient production session API: it does not expose every original source file or all loader/recording state. Each historical adapter must register against the historical module's own state and functions.

## Existing integration points verified during planning

- `src/main.js`: `loadAudioFiles`, `handleFiles`, `offerWorldsThenStart`, `startConfirmedWorld`, `startTimeline`, `seekSong`, `togglePause`, `stopTimeline`, `wakeHud`, `hudIdleTick`, `running`, `paused`, `lastAudioBuffer`, `loadGen` and recorder/export state.
- Successful raw-file loading converges before `offerWorldsThenStart`; do not capture only `#fileInput` change, because file drops, library loads and URL loads use other routes. The input is cleared immediately after change.
- `startConfirmedWorld` currently calls `startTimeline` and then `audioEngine.playBuffer(buffer, 0)`. Restoration must change both the initial simulation time and the initial audio offset; calling `__SMW.seek` after an ordinary start is insufficient. `bootAudioOnce` can reject before loading when browser audio activation is missing. Preserve the restore intent for a gesture-driven retry.
- `startDemoSample` is a separate source path. Support it with a `demo` descriptor (the destination's own built-in demo and the saved seed/time), not stale raw files. Label that limitation: an older release may have a different built-in demo.
- `index.html`: `#hud`, `#hudLeft`, `#hudRight`; all inspected older versions expose these IDs, including #338.
- `src/ui/style.css`: `.hud-faded` currently sets opacity/pointer behavior. Make hidden navigation inert/unfocusable as well.
- `tools/stage-site.mjs`: strict public-file staging, destructive-path guards, runtime/terrain hash verification. Preserve these contracts when adding archive staging.
- `.github/workflows/static.yml`: validates before staging and deploying. `.github/workflows/test.yml` also stages the site in several browser jobs. Avoid multiplying the full archive build across every smoke job.
- `tools/range-scene-smoke.mjs` and existing headless browser infrastructure can load audio and inspect actual Range activity. Historical scene kinds differ: older Range, Cove and Journey must each be verified according to their source, not all asserted to be Journey.

## Acceptance

The user can load one song, move backward to pre-Journey rendering and forward through both circular experiments, identify each checkpoint, and return to live. Every destination uses its declared source and preserves the song/seed/position within the stated handoff limits. Both arrows disappear and become inert with the HUD; wake/focus, mobile controls, exports, and existing playback remain correct. The live repository is not rolled back by browsing. Deliver actual desktop/portrait screenshots and a short click-through recording; passing tests alone do not establish that versions visibly differ.
