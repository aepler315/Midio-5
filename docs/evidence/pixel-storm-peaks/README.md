# Pixel presentation, storm, and cast evidence

Before/after frames compare the baseline Range modules at 96908d0 to the implementation, at each individual held lane peak. The new display code is shared between both captures to isolate landscape changes. No fabricated terrain or illustration is used.

Reproduce with `PLAYWRIGHT_CHROMIUM_PATH=<browser> node tools/peak-evidence.mjs before` and `npm run test:peaks`. Set `EVIDENCE_VARIANT=dawn`, `sunset`, `squall`, `clearing`, or `shed` for the corresponding checks. Rendering uses software WebGL in this environment. See the manifests for captured view, actor, light, quality, and material state.

`PR-description.md` contains the prepared GitHub description and all six before/after pairs. Its raw image URLs resolve after this branch is published.
