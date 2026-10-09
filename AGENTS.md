# Midio-5 coding workflow

For work that changes rendered appearance or its relationship to music, use
`docs/visual-evaluation-loop.md` before editing. Capture a baseline with
`npm run visual:eval -- --out .smoke/<unique-baseline>`, inspect the actual
images and matching audio, make a scoped change, then capture the identical
manifest as a candidate and run `--compare`.

State the song and timestamp for each finding. Judge musical legibility,
composition and motion from rendered evidence. Numeric controls, passing
unit tests, or changed pixels alone are not visual acceptance. Use continuous
capture when changing render history; sparse captures skip draws between
windows. Preserve baseline evidence and unrelated work. Do not auto-promote
an aesthetic change merely because the capture command passed.

Run relevant behavior tests and `npm test`/`npm run lint` before completion.
Document unavailable browser/device checks accurately. For nonvisual changes,
use the tests relevant to the change; a visual capture is unnecessary.
