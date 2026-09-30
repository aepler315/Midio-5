# Audio / Range V2 Implementation Plan

**Goal:** Implement the attached audit's evidence repairs, musical terrain responses and earned 1–3 biome policy.
**Architecture:** Pure analysis and chapter contracts feed deterministic time-sampled render state. Keep authored structure, section variation, chapter identity and terrain motion separate.
**Tech Stack:** JavaScript ES modules, Node tests, Three.js/WebGL.
**Spec:** `docs/superpowers/specs/2026-09-30-audio-range-v2-design.md`
**Execution:** Independent file-owned domains in parallel, integration and timing by the primary agent, then fresh review. No additional user approval gates.

## Global Constraints

Keep the approved scenic catalog and luminous Dancing Ridge. Do not add a genre/transcription model. Confidence .65 and 45-second/16-bar dwell are experimental defaults. Maximum three unique biomes and two transitions. Preserve home/past during analysis refinement. Keep GPU/source-space deformation coherent and pin shores before increasing displacement.

## Review Focus

- Malformed, truncated or legacy cached analysis must reanalyze.
- Silence and free-time openings must stay geographically stable.
- Repeated choruses must retain in-place variation without spending travel budget.
- Seek/pause/latency must reconstruct accents without spawning past effects.
- Deformation must retain root and water attachment at all quality levels.

### Task 1: Audio evidence and cache

Files: `src/audio/*`, `src/core/NoteEvent.js`, `src/world/dna/SongDNA.js`, RidgePortrait's physical-share consumer, dedicated audio tests.
- [x] Write regressions for A2–A9: final section, recording key, physical shares, bass semitone sweep, loudness contrast, local rhythm drift, silence identity, bundle corruption.
- [x] Run failing tests; repair contracts and bump cache semantics.
- [x] Move structure computation off-thread or to bounded chunks with abort/fallback parity tests.
- [x] Run relevant audio tests and record results.

### Task 2: Biome chapters and provenance

Files: BiomeManager schedule methods only, SongForm, SectionFusion, BiomeSet, new pure chapter planner and tests.
- [x] Reproduce decorative early B and silent fabricated classes.
- [x] Preserve parent IDs/provenance; add chapter planning with independent evidence, dwell, total count and joint optimization.
- [x] Keep section variants/motifs independent of biome; preserve future-only full-analysis changes.
- [x] Test pop recurrence=1, sustained contrast=2, three movements=3, long vamp=1, brief fill=1, returning sections, silence, free time and deterministic seek.

### Task 3: Range expression and water

Files: `src/world/alpine/*`, affected water/contact renderers, motion pilot and dedicated tests.
- [x] Add independent rhythmic/sustained/gesture/melodic counterfactuals and deformation parity regressions.
- [x] Implement bounded coherent response, view-depth calibration and shoreline pinning before amplification.
- [x] Carry pool alpha and onset strength through GPU water; preserve reduced-motion semantics.
- [x] Extend the pilot through calm/energetic/calm and test deterministic frames.

### Task 4: Pulse, heard clock and seek

Files: Simulation, BeatAnchor/transport, BiomeManager update/event-history methods only, timing tests.
- [x] Reproduce 90 BPM becoming 120 and sparse kicks halving tempo.
- [x] Add source-authoritative local beat transport with phase/confidence/free-time and route decorative time through output-lag compensation.
- [x] Reconstruct recent kick/gesture state from timeline without dispatching old cues.
- [x] Test latency, downbeat, local tempo, seek and pause.

### Task 5: Integration, verification and PR

- [x] Run full Node suite, lint and feasible browser pilot; inspect findings and fix material regressions.
- [x] Fresh review of the full diff against the spec and audit; fix important findings and rerun checks.
- [x] Document exact verification, tuning defaults and remaining external evaluation needs.
- [x] Commit, publish feature branch and open PR against main through GitHub.

## Verification record — September 30, 2026

- Final `npm test`: 3,485 tests, 3,480 passed, 5 skipped, 0 failed (65.35 seconds). Run with local socket access for the server tests.
- Final `npm run lint`: passed. `git diff --check`: passed.
- Direct chapter-policy suite: 16 passed, including actual analyzer-to-manager handoff, nonzero first downbeat, physical material shares and rejected-fill return. Direct audible-transport and Range-expression regressions also passed.
- Fresh review found five integration defects plus a low-confidence local-tempo gap. Added regressions and repaired all six before the final full suite.
- Browser pilot: served-source identity checked and launch attempted; Chromium was unavailable and browser downloads were truncated. No browser capture, real GPU compilation, visual-quality or FPS result is claimed. The deformation parity check compares CPU math with the shader's numerical expression.
- Confidence .65, 45-second/16-bar dwell and motion bounds remain conservative tuning defaults. Natural-song listening and phone/Bluetooth/hardware evaluation remain external validation needs.
- Publishing and PR creation are the final delivery steps; the implementation and verification above are complete.
