# Audio evidence, Range motion and biome chapters

Implements the user-supplied September 29 audit of main `26f3ba8`. The user requested implementation of that audit. Preserve the landscape, Dancing Ridge and detailed musical sections while repairing evidence contracts and making actual terrain participate in music.

## Contracts

- Recording chroma owns tonal identity; authored MIDI pitches own MIDI identity. Preserve inferred/tracked/synthetic provenance and confidence.
- Include the final section, treat silent features as unknown, preserve parent IDs and provenance through padding and lyric fusion.
- Distinguish normalized activity from physical RMS/power shares. Repair bass subharmonics, accent loudness and drift-sensitive regularity. Confidence-gate provisional opening tempo. Reject malformed cache data and version changed semantics.
- Detected/MIDI beat period and phase own transport. Kick intervals govern jumps only. All decorative envelopes use presentation time minus output lag once; timeline-derived recent accents reconstruct on seek.
- Range uses one coherent source-space deformation for terrain and roots, consumes gesture and distinct rhythmic/sustained/melodic channels, respects relief caps and lake/shore receivers. Preserve pool opacity and hit strengths. Reduced motion and reduced flash have separate meanings.
- Chapters admit at most three unique biomes and two transitions. Start at home; duration alone, silence, decorative sections, lyrics and asset arrival never admit travel. Require valid confidence >= .65, persistent independent evidence, and settled dwell >= max(45 seconds, 16 reliable bars), plus travel duration. Choose the best legal boundary combination with duration-dependent cost. Sections and motifs remain independent of biome identity.
- Full analysis preserves home and committed chapter past, refining only eligible future boundaries. Structure analysis runs in a worker or bounded asynchronous chunks.

## Validation

Use producer-to-consumer regression tests for audit counterexamples, synthetic semitone and dynamics probes, chapter policy fixtures, CPU/GPU deformation parity and actual seek lifecycle comparisons. Run the full Node suite and lint. Extend the motion pilot beyond the energetic transition and attempt browser verification. Natural-song listener preference, phone/Bluetooth performance and learned policy thresholds require external evaluation; no such result will be claimed from synthetic tests.
