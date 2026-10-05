# Production evidence runs

A production run is one recording analysed **whole** by the browser analyzer Midio plays with, plus its live heuristics stepped through the song the way playback steps them. It is the machine half of a listening case (see [pipeline-design.md](./pipeline-design.md)) and the baseline for visual/musical tuning. Human labels never enter it.

```sh
node tools/listening/export-production.mjs --audio <local-file> --out .listening/<case> [--case-id <corpus id>] \
  [--step-ms 16.6666666667] [--sample-ms 100] [--world <id>]
node tools/listening/review-book.mjs --runs .listening --out .listening/book \
  [--bindings-out docs/listening/corpus/bindings.json] [--split-out docs/listening/corpus/split-manifest.json]
```

`.listening/` is git-ignored. Recordings stay where you keep them; the exporter serves the bytes to a local headless Chromium from memory and writes only their hash and base name.

## What run.json holds

| Layer | Contents | Source |
| --- | --- | --- |
| Identity | Recording SHA-256, base name, byte length, decoded rate/channels/frames/duration; source commit, whether `src/` was dirty, the hash of every module the page actually loaded; configuration hash; browser and Node versions | Exporter |
| Coverage | Analysed interval measured from what was analysed (`opening.analyzedMs` for a provisional opening, which advertises the whole duration), heuristic sample range | `measureCoverage` |
| Evidence | Energy per band and global on the run grid; per-frame brightness and spectral peak energy, unquantized; global key and key timeline with confidence; tempo and local tempo; structure; raw onsets by role; authored vs inferred pitch counts; the song profile without its capped onsets | `AudioAdapter.audioToTimeline(…, { diagnostics: true })` |
| Heuristics | Calm, hype, vibe valence/epic/tonic, key rotation, weather, opening, coda — sampled every `--sample-ms` of heard time while a Simulation is stepped from the start on `--step-ms`, each with its scale | `sampleHeuristics` |
| Semantic | `unsupported` — no emotion predictor exists | — |

`validateRun` refuses provisional-only or short coverage, a hash or commit other than the one expected, missing provenance, inconsistent sampling, and any semantic output from an unsupported layer. The analysis runs fresh (no cache, no learned groove, no opening slice) at zero output latency.

## Corpus binding and the review book

`review-book.mjs` binds each case in `test/fixtures/world-evaluation.json` to the runs whose `--case-id` names it. Only a valid run of the bytes binds; a title or URL never does. Generated MIDI is marked synthetic, feature-only slots unavailable, the operator slot unbound. One recording on both sides of the split is refused. The output is:

- `book.json` — one case per corpus entry with empty `appeal`, `musicalTiming`, `blockingDefect`, `listenerNotes`, `reviewer`, `reviewedCommit`; a person fills these after watching matched playback.
- `book.md` — the coverage/denominator table and an exploratory digest per run.
- `charts/<case>.svg` — measured energy (1 s means) against calm, epic, valence and tonic confidence.
- `split-manifest.json` — recording groups per side and the recordings bound to them, with a revision hash.

The acceptance target is unchanged from [world-quality-evaluation.md](../world-quality-evaluation.md): appeal and musical timing both ≥ 4/5 with no blocking defect in at least 80% of reviewed held-out cases. Only bound real recordings with complete reviews count; synthetic or unrated cases never do. With no complete held-out review, no rate is reported.

## First baseline, October 5, 2026

Eight corpus recordings (the SoundHelix demo files the corpus already references) were downloaded outside the repository and exported at commit `d469092` (`feat/production-evidence`, main `5ebd89b` plus this tooling) in headless Chromium 153.0.8010.12 on Linux, decoded at 44.1 kHz, step 16.67 ms, sample 100 ms. All eight runs validate. Bindings and the frozen split are in [corpus/](./corpus/).

| | Tune | Held out |
| --- | --- | --- |
| Corpus cases | 8 | 8 |
| Bound real recordings | 4 | 4 |
| Synthetic (generated MIDI) | 3 | 1 |
| Unavailable / unbound | 1 feature-only | 2 feature-only, 1 operator slot |
| Complete human reviews | 0 | 0 |
| Acceptance rate | none established | none established |

Machine observations only. They identify places to watch during review; none is a judgment of how the result looks or feels.

- **Tempo.** Detected tempo is 194–295 BPM on all eight recordings, at confidence 0.42–0.58. The corpus feature snapshots list 58–140 BPM for the same tracks. The ratios (2.0–4.7×) are not consistent whole multiples, and the snapshot values are unverified, so this needs checking by ear before anyone calls it a detection error. If the detection is wrong, anything locked to the beat (camera, pulses, kick-driven effects) would be running faster than the felt pulse.
- **Calm.** `calm.level` crosses 0.5 between 3.7 and 32 times per minute, with jumps larger than 0.3 inside 100 ms (up to 86 per song). It behaves like a fast gate, not a slow calm state.
- **Little contrast between songs.** Mean `vibe.epic` is 0.76–0.79 and mean valence −0.52 to +0.07 on drones, percussion, bass and orchestral pieces alike.
- **Tonal evidence.** Global key confidence ranges 0.03–0.48; every pitch is inferred (audio), none authored. This run predates PR #375 (pitch provenance in live tonal controls), so it shows the tonic wandering at low confidence that #375 addresses — useful as its before.
- **Drops.** One detected drop across all eight songs.

Each export took 17–34 s of analysis and 18–38 s of heuristic stepping for 4.7–8.8-minute songs.

## Not done here

- **Human review.** Nobody has watched matched playback of these runs or filled in the book. That is the next step, before any tuning (plan Task 13).
- **Listening annotations.** No human annotation exists for these recordings. Synthetic data and the illustrative example check bookkeeping only.
- **The operator slot and feature-only cases** need a recording you choose and are authorized to use.
- **Matched-playback capture** of the same recordings at the same heard times, for the review, is a separate step (the Range smoke tools can capture frames; long-recording capture has not been run).
