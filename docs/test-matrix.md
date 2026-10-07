# Validation matrix

What CI actually runs, what those jobs prove, and what they do not.
This is the QA-001 contract: a workflow-to-test map with explicit
thresholds, supported environments, and unverified cases. It is not a
claim that product assurance is complete.

Revision tagged against the 20432ab audit unless a later row says otherwise.

## Supported environments (measured)

| Surface | Environment | Evidence |
| --- | --- | --- |
| Root unit tests | Node 24 on `ubuntu-latest` | `.github/workflows/test.yml` job `test` (`npm test`) |
| Root lint + high-severity audit | Node 24 on `ubuntu-latest` | same job (`npm run lint`, `npm audit --audit-level=high`) |
| Browser smoke | Playwright Chromium on `ubuntu-latest` | jobs `audio-smoke` and `world-chooser` |
| Local audio-only app | Chromium-family browsers | README + `npm start` on loopback |

Root `package.json` scripts that CI does **not** run on every PR:
`bench:sections`, `eval:worlds`. Those are operator tools. `test:car` runs in
the `audio-smoke` job.

## Workflow jobs

| Job | Command / check | Pass bar | Proves | Does not prove |
| --- | --- | --- | --- | --- |
| `test` | `npm ci`, `npm audit --audit-level=high`, `npm run lint`, `npm test` | zero failing Node tests under `test/*.js`, `test/*.mjs`, `test/helpers/*.js`; lint clean; no high+ npm advisories | Unit contracts for analysis, library fakes, export estimates, UI helpers | Real IndexedDB in a browser; Firefox/Safari; long recordings; physical devices |
| `audio-smoke` | Playback/lighting/shading/seek/world/export/car/URL-loader smokes against source, then `stage:site` + `test:bootstrap` against that artifact | each script exits 0; staged Browse opens a real chooser; artifacts under `.smoke/` | Chromium can boot the actual public file set, upload a short synthetic fixture, pick a world, draw, seek, and start an export | Watchability, identity, other engines, songs longer than the fixture |
| `world-chooser` | `npm run test:chooser`, `test:chooser-keyboard` | exit 0 | Pointer and keyboard world selection in Chromium | Visual distinctness of the nine worlds |

GitHub Pages deploy stages one artifact with `stage:site`, runs bootstrap and
audio playback against that exact directory, uploads it, and deploys only
after the reusable validation workflow succeeds. It publishes `index.html`,
`src/`, `soundfonts/`, `CNAME`, and `.nojekyll`; it does not publish tools,
tests, raw terrain inputs, or the Soulseek bridge.

## Thresholds that are measured today

- Root CI: the `test` job must be green. The 20432ab audit recorded 2,735
  passing root tests on that commit; later main may differ. Do not treat
  the audit count as a live gate.
- Browser smoke: generated ~24 s PCM fixture, 720p, lyrics off, timeline
  synth muted. Failure exits nonzero.
- World quality: the 80% holdout appeal/timing target in
  [world-quality-evaluation.md](./world-quality-evaluation.md) stays a
  target. `claimed: false` until a revision-tagged holdout sheet exists.
- Section metrics: [analysis-evaluation.md](./analysis-evaluation.md)
  scores a supplied annotated corpus. No revision-tagged held-out music
  result is published in this tree.

## Explicitly unverified

- Real-browser IndexedDB persistence, permission restore, and transaction
  rollback (unit tests use `test/helpers/fakeLibraryIdb.js`).
- Firefox and Safari library/folder restore (README already notes they
  cannot reopen a folder handle alone).
- Maximum-duration export memory on a physical machine. Unit tests can
  cap encoded bytes; they do not measure peak RSS of a 4K take.
- WebGL2 overlay (`?renderer=webgl`) across GPUs.
- Non-Chromium smoke, mobile browsers, and car head-unit hardware
  (`npm run test:car` is local).
- Human world-identity ratings on holdout music. See
  [visual-review-20432ab.md](./visual-review-20432ab.md).
- Branch-protection settings (the 20432ab audit could not read legacy
  rules; do not infer the default branch is unprotected).

## Adding a gate

1. Give the job a stable `name:` / job id in `.github/workflows/test.yml`.
2. Add a row here with the command, pass bar, and the unverified remainder.
3. Keep `test/validationMatrix.test.js` green — it checks that every job
   id in the workflow is named in this file.
