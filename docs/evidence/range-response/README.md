# Range musical response — 2026-10-05

[Before/after clip](comparison.mp4) · [Machine measurements](summary.json)

The clip compares the same one-second passage (44–45 s), repeated four times
with its generated audio. Before is on the left, after on the right. Both
captures use the real compositor, approved Teton view, pinned CONIFER biome,
identical seeds, 640×360 dimensions and 12 fps fixed-step export. Only
`RangeFrame.js` differs. The change is deliberately small: musical motion
returns to the land without restoring the former full-strength heave.

All 24 frames rendered through v2 without page or shader errors, at matching
quality. All twelve paired frame hashes differ. At 6 s, outside a section
swell, the old final motion bound is zero and the new bound is 8.076 m before
view calibration. This confirms that previously discarded musical activity
reaches final terrain geometry. A bound is not a measured pixel displacement.

The independent review also found a pitch-dependent phase problem in the
restored source channels. A MIDI pitch transition at five minutes jumped up
to 2.478 pixels per 60 Hz frame; the fixed melodic carrier brings that test's
maximum to 0.068 pixels per frame. The history-driven regression covers it.

Validation on implementation commit `14a7c510ce3b38b526a3820977d86fe4bffc41f7`:
3,911 tests passed, zero failed; lint and diff checks passed. The independent
review found no remaining actionable issues after the phase fix.

Reproduce with a local server on port 8092:

```
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium node tools/range-response-evidence.mjs http://127.0.0.1:8092 dfb0a3ced552da04ad2ccf5052bdb5b7ce6e7ea6 .smoke/range-response
```

These are synthetic audio and software-WebGL captures, not a device frame-rate
measurement or human listening acceptance on real recordings. Full frame
sequences and the raw report remain in the tool's output directory; the
committed summary records source/audio hashes and per-frame renderer identity.
