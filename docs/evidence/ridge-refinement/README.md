# Dancing Ridge refinement

Follow-up to merged PR #344 and user feedback that the ridge still looked anxious and visually weak.

## Bounded design

The audible gate and raw source pitch bypassed the existing causal release filters in the horizon sampler. A new kick also discarded the previous kick's unfinished envelope. Both produced actual positional discontinuities. The horizon now consumes filtered presence and weighted melody; overlapping kicks retain the strongest continuous envelope with the original single-hit response and a unit bound.

The art adjustment gives the geographic outline one broad carrier (0.8 rad/s, one wavelength across the viewport), shares band lift equally between the mean and travelling local band, and puts melody on that same clock. Geographic travel and source-specific horizontal band speeds are unchanged. The core is 2.8 px at 720p with steady opacity and a 12 px translucent body directly below it. Both remain in the existing far → ridge → middle → near depth order.

This changes ordinary views. It does not promote the earlier composition candidates or redesign the foreground, sky ridge, or water. A ridge hidden by nearer geometry remains hidden.

## Verification

- Three new horizon regressions failed before the sampler change and passed afterward: silence-edge continuity, a broad slow carrier, and shared lift with a retained local accent.
- Kick-overlap regressions failed before the history change and passed afterward; cover weaker/dense hits, query order, seek, handoff and reduced motion.
- Full Node suite: 3,678 passed, five existing GDAL-dependent skips, zero failures.
- ESLint and `git diff --check` passed.
- Independent review found no important correctness issues; overlap pruning agreed with an exhaustive reference at 1,242 samples.

`metrics.json` records synthetic geometry comparisons, with source hashes and limitations. These measurements do not establish final appearance.

## Browser acceptance

The existing `Landscape visual` primary capture exercises the legacy renderer, so its previous green status did not validate the user's v2 scene. The workflow now also runs `range-scene-smoke.mjs --suite short-motion`: 72 actual Chromium frames at 24 fps, approved `teton-jackson-lake`, controlled CONIFER biome, production compositor, analyzed synthetic audio from 44–47 seconds. Frames cross an energetic-to-calm transition. Actual horizon selection and scene/source identities are recorded; no renderer passes are disabled.

The run retains ordered PNGs, an MP4 when ffmpeg is available, and `range-scene-report.json`. These are fixed-step export frames, not evidence of device frame rate or a match to the user's recording. Browser visual acceptance is pending at this commit; the PR records the resulting inspection.
