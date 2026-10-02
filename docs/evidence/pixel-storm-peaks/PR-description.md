Pixel playback and recordings now use the same sharp 320×180 presentation, with display look separate from rendering quality. Cathode is retired; saved playback IDs resolve to The Range, and its removed title choice follows the existing Ask fallback. Natural stays the default, and legacy 8-bit preferences preserve their Economy behavior.

The Range gets one song-relative climax squall: darkening sky, distant rain curtains, rate-limited snare lightning illuminating the peaks and water, then clearing sunlight and wet-ground response. The selector scores sustained early sections after clipping arrival time rather than discarding them, and also includes late climaxes and sustained early/late windows in unsegmented songs. Weather follows heard time through seeking and export; Reduced Flash disables lightning.

Each instrument lane stays a small light between peaks and becomes landscape-sized at its own peak: Midio appears only in the lake mirror, Broshi projects a mountainside shadow, and Midasus forms in cloud radiance. Midio falls back to clouds in views without visible mirror water. World-space material masks use terrain depth, scene light, bounded residency, and the mirror's quality cutoff. Dark dawn and sunset captures are included.

Validation: `npm run lint` passed; `npm test` passed 3,714 tests with five existing skips and no failures. The early-climax regression reproduced the bug before the fix; all eight storm tests pass afterward. Browser evidence includes both real-terrain views at all three held individual peaks, dawn/sunset, squall/clearing, quality shedding, four palette output sizes, and recording decode checks (17 passed). These software WebGL captures establish rendering behavior; hardware FPS was not measured.

## Before / after

Held individual peaks, 20 seconds of heard time, 960×540 output, quality 0, seed 24681357. Baseline alpine modules come from `96908d0`, with only the individual diagnostic peak override adapted. Both render paths use the same generated audio fixture. Manifests and verification record accompany the frames.

| View and lane | Before | After |
| --- | --- | --- |
| Teton / Jackson Lake — Midio | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midio-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midio-after.png) |
| Teton / Jackson Lake — Broshi | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-broshi-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-broshi-after.png) |
| Teton / Jackson Lake — Midasus | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midasus-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midasus-after.png) |
| Tombstone / North Klondike — Midio | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-midio-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-midio-after.png) |
| Tombstone / North Klondike — Broshi | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-broshi-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-broshi-after.png) |
| Tombstone / North Klondike — Midasus | ![Before](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-midasus-before.png) | ![After](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/tombstone-north-klondike-midasus-after.png) |

## Weather

| Squall and cloud lightning | Storm breaking |
| --- | --- |
| ![Squall](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midio-squall.png) | ![Clearing](https://raw.githubusercontent.com/aepler315/Midio-5/refs/heads/codex/pixel-presentation-upgrade/docs/evidence/pixel-storm-peaks/teton-jackson-lake-midio-clearing.png) |

[Dawn manifest](docs/evidence/pixel-storm-peaks/dawn-manifest.json) · [Sunset manifest](docs/evidence/pixel-storm-peaks/sunset-manifest.json) · [Verification](docs/evidence/pixel-storm-peaks/verification.json)
