Pixel presentation repair evidence for PR #422

Implementation commit: dac52b6b4f493f22108e8df5a62d7c3ffab98fb2
Public source SHA-256: a65fa654fee2b9c532a03a00be694dd7275c19a0e07a26b3d8a47c5a42587e2a

Download pixel-repair-report.html to view the matched gallery offline.
Download and extract pixel-repair-evidence.zip for original PNGs, generated audio, comparison reports, actual MP4 recordings, failure logs and implementation patch.
Use evidence-manifest.json to verify the archive, report and every packaged artifact.
The evidence branch intentionally keeps large generated files out of the implementation PR.

All 18 matched successful-scene PNGs are identical before/after. Integer raster fixtures improve from 29 fractional origins / 17 failed grids out of 32 to zero. All 26 live fallback encode/decode checks pass. Actual v2 buffers and fallback are verified in browser CI; two live v2 encoding attempts timed out. Hardware/Safari/long authored-camera/full-cast checks remain unverified.

PR #422 was merged by account aepler315 while verification was finishing.
Main squash commit: 7862d4e695daf1633ee3608b1047b19456b5e47c
Verified its complete Git tree matches implementation commit dac52b6, including the smoke-test correction.
