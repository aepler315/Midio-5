# Visual evaluation loop

Give a coding model a repeatable way to load audio through the real app, inspect pixels and motion, make a scoped change, and compare the same input again. Build on the export clock and Range diagnostics already in main; do not change the visualizer's artistic behavior.

## Design

A local CLI owns an ephemeral loopback server and Chromium. The server serves an immutable snapshot of index.html and src; record SHA-256 hashes, git commit, dirty state, browser version, seed, audio hashes, and capture settings. No dependency on a previously running server or a deployed site.

A versioned JSON manifest selects generated fixtures or local recordings, viewport, seed, quality, Range view, optional biome pin, checkpoints and motion clips. Defaults exercise silence, isolated kicks and quiet/loud/quiet contrast. Use the real audio upload and analysis path. Never modify audio analysis to obtain a passing picture. Copy source audio into the ignored run folder for offline listening; do not commit private recordings.

Use the fixed export clock. Sparse mode draws checkpoints plus every frame of selected clips, with one second of drawn pre-roll; it advances simulation across gaps but is explicitly not continuous playback. Continuous mode draws every frame from zero through the last requested sample. Persist requested and actual time, Range runtime/active/view state, audio controls, camera/weather state, image hashes and small image thumbnails. Reject wrong clocks, dimensions, quality, inactive v2, missing assets, browser/shader errors and empty capture sets. Preserve a failed report and partial evidence.

Each run produces JSON and an offline HTML contact sheet with time-stamped screenshots, an audio player and synchronized clip playback. A comparison command requires matching inputs, settings, browser and schedules; it generates side-by-side images, changed-pixel diagnostics, and explicit unevaluated review questions. Pixel differences are not an aesthetic score. Candidate acceptance is a coding-model/human judgment based on listening and viewing the evidence.

Keep production source unchanged. Reuse pinned dependencies; use existing CI setup. Add a PR/manual workflow that retains evidence even on failure. Document the exact baseline → inspect → one hypothesis → edit → candidate → compare → retain/revert loop, including limits of software WebGL and export-clock evidence. No automatic production deployment or automatic aesthetic approval.

## Verification

Unit tests pin manifest validation, schedules, comparison compatibility and mismatch handling. Exercise the real CLI on generated fixtures and repeat an identical manifest. Inspect actual PNGs. Verify a malformed manifest and incompatible comparison fail. Run the repository suite and lint. If local browser execution is unavailable, report that explicitly and run the same command in CI; do not label code-only checks as visual validation.
