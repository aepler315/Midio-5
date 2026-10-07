# Version browser evidence

The version browser loads eight pinned, independent builds on one origin. Mountain valley (#399) stays at the live root; the two later experiments remain reachable. The navigator carries original ordered files, seed, supported world settings and heard position through full-page navigation.

Build tested: `2c7f30b1f2e330eb06b9cacabd931d875a64acf9`. Full artifact: **752,459,181 bytes (717.60 MiB)**, below the **838,860,800-byte** limit with 86,401,619 bytes of headroom. Local full staging took **52.785 seconds**. Generated archives are excluded from Git. The release workflow stages and uploads `_site`, including `versions/`.

The full browser gate passed at both **`/`** and **`/Midio-5/`**: **40 native scene captures**, covering all eight checkpoints forward and backward, **50 restore observations**, and **recovery/isolation checks at each prefix**, with zero unexpected runtime, resource or shader errors. Every restored real-time soundtrack was scheduled while suspended at the saved offset, within 100 ms before resume; ordered original file metadata, source identity, seed and pause state survived. Desktop and mobile target geometry, current checkpoint labels clear of orientation guidance and controls, focus hold, reduced motion and the existing running HUD timeout passed. Renderer/source hashes and served assets matched the pinned staged builds.

Harness verified: `f4d5fca01f16d9d7072fb25c18c7ca3449c7b7f8`. Evidence captured 2026-10-06T21:03:46.639Z–2026-10-06T21:19:31.407Z.

Verification commands use `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium` in this environment:

```sh
npm test
npm run lint
npm run stage:versions
npm run test:versions -- --site _site
npm run test:bootstrap -- http://127.0.0.1:4182
npm run test:smoke -- http://127.0.0.1:4182 .smoke/version-browser-live-audio
```

The unit suite passed **4,004 tests**, with one skipped and zero failures. Lint, complete staging, staged bootstrap and the existing staged audio smoke (**23 checks**) passed. Independent review passed staging safety, source fidelity, per-document ownership, generation races, recovery guards and HUD/input behavior.

| Checkpoint | Source | Frame |
| --- | --- | --- |
| Glacial valley | [#338](https://github.com/aepler315/Midio-5/pull/338) · `bbe0afcae722c59c774b5c7396b55cfa4342c616` | [Screenshot](screenshots/glacial-flight.png) |
| Original Range | [#391](https://github.com/aepler315/Midio-5/pull/391) · `7383b3b34c4f5e1f3cf062fb6078178aaa24a0b6` | [Screenshot](screenshots/range-before-journey.png) |
| Moonlit cove | [#396](https://github.com/aepler315/Midio-5/pull/396) · `70c9cb8f8fa1aae40a51060b1d2f132af9ee5ca4` | [Screenshot](screenshots/moonlit-cove.png) |
| Traveling valley | [#397](https://github.com/aepler315/Midio-5/pull/397) · `316e50ea1db66c185d194f511a8a1cc62bb7a936` | [Screenshot](screenshots/traveling-valley.png) |
| Detailed valley | [#398](https://github.com/aepler315/Midio-5/pull/398) · `be8d0c4c0bd33e3839ba2a8b6f154a9e38e0ebef` | [Screenshot](screenshots/detailed-valley.png) |
| Mountain valley | [#399](https://github.com/aepler315/Midio-5/pull/399) · `7557f85bae8e4f7d61f5fd9d8d628d52c052565c` | [Screenshot](screenshots/natural-valley.png) |
| Circular world | [#400](https://github.com/aepler315/Midio-5/pull/400) · `4c61f72d4cb782822fcabf5d2b1c8e785cc13e16` | [Screenshot](screenshots/circular-world.png) |
| Curved landscape | [#402](https://github.com/aepler315/Midio-5/pull/402) · `a901332676557d33536d2cbbd1e1a4da9de4a4ca` | [Screenshot](screenshots/spherical-world.png) |

[Aggregate report](reports/summary.json) · [Root report](reports/root.json) · [Project-prefix report](reports/project-subpath.json) · [Staged manifest](reports/manifest.json) · [30-second click-through sample](click-through.mp4) · [Root portrait](screenshots/portrait-root.png) · [Project-prefix portrait](screenshots/portrait-project-subpath.png).

The silent click-through sample contains the successful root run's actual browser screencast frames, sampled every two seconds, with the complete sampled sequence compressed to 30 seconds (approximately 8.5× speed). Screenshots are unedited captures from the successful root traversal. Reports retain measured audio starts, file metadata, native scene identity, resource hashes, while omitting verbose scene actor poses.

Compatibility: a generated custom world carries its registered base ID, then each destination recreates the variant using its own existing analysis and factory. No renderer or analysis algorithm is transplanted. Scene readiness is generation-bound and a paused restored frame is drawn before playback may resume.

Lifecycle ruling: Chromium can drop asynchronous unload writes. A small transport-only sessionStorage journal therefore supplements the IndexedDB snapshot; merging requires the owned tab token and matching canonical source. Original audio stays exclusively in IndexedDB. Synchronous invalidation prevents an old journal from reviving a replaced song.

Browser scope: Chromium 151 with software WebGL. Default settings cover paused scene traversal; later running playback checks select native 360p/30fps through the real Display UI to keep software rendering responsive. No legacy renderer or autoplay bypass is used. Resume, when required, is a real click. Recorder probing and its evidence are excluded at the user’s request. Physical iOS policy and acoustic output were not measured. Historical reanalysis may produce different views and timing details; pixel identity across builds is not promised.

**Deployment is not complete.** This work is published for PR review without merging or deploying production, so real deployment duration remains unmeasured. Workflow inspection confirms Pages uploads `_site`; hosted Pages configuration and delivery of the new archives have not been exercised.

Resource auditing used 86 recorded fallbacks for closed or stalled Playwright response-body reads. Each fallback fetched the same immutable staged URL with a bounded timeout and required the staged SHA-256 digest; reports retain its file, reason and digest.
