# Super Maudio World

Drop a song and watch it become a world. Super Maudio World is a browser
music visualizer with an automatically choreographed cast, moving scenery,
and musical effects. The recording supplies the sound; its analysed rhythm,
pitch, energy, and structure drive the performance.

The root app uses plain JavaScript modules, Canvas 2D, and Web Audio. An
optional WebGL2 overlay adds post-processing. There is no frontend build
step for this app.

## Run locally

Use Node.js 24 (the version used in CI) and npm:

```sh
npm ci
npm start
```

Open [localhost:8080](http://localhost:8080). The server binds to
`127.0.0.1` by default. Set `HOST=0.0.0.0` only when you intentionally need
LAN access, or set `PORT` to change the port.

1. Drop an audio file anywhere on the page, or choose **Browse files**.
   The picker accepts MP3, WAV, FLAC, OGG, M4A, AAC, and other audio formats
   your browser can decode.
2. Wait for audio analysis and world generation. The app automatically
   selects a base world style and customizes it for the song.
3. Watch the performance. Midio plays himself; there is no movement control
   or failure condition. Optional taps help calibrate the groove.

Several files selected or dropped together are treated as **stems of one
song**, summed for playback and analysis. Use descriptive names such as
`bass.wav`, `piano.wav`, `lead.wav`, and `vocals.wav` to help assign
musical parts. They should share a common start time. This is not a playlist.

Dropping a new recording during playback replaces the current song after
the new recording has been prepared. **Stop** returns to the upload screen.

The current page has one entry path: audio uploads. MIDI uploads, paired
MIDI/audio playback, the built-in demo, and song-search controls are no
longer part of the page. MIDI and synthesis modules and the local
Soulseek/free-music bridge remain in the repository for internal or legacy
use; Docker and a Soulseek account are not required to play uploaded audio.

## Controls and preferences

| Control | Effect |
| --- | --- |
| Pause / Resume | Freeze or continue the performance and audio together |
| Stop | Stop playback and return to the upload screen |
| Fullscreen button | Expand the performance |
| **Timed lyric grounding: on/off** | Enable or skip lyric lookup; remembered between sessions |
| Stage selector | Choose the render resolution, including 8-bit and 8-bit intensive presets |
| Frame-rate selector | Cap rendering at 30 or 60 fps |
| **BT +30ms** | Toggle an additional 30 ms visual delay for manual Bluetooth correction |
| **Sync** button or `C` | Open guided tap calibration |
| `F` / `J` | Tap the low / high percussion parts for groove calibration |
| `R` | Toggle reduced flashes, shake, and cuts |
| `P` | Toggle the FPS display |
| `T` | Toggle track details when available |
| `F3` | Toggle section labels on the mountain seekbar |

Reduced motion preferences enable reduced-flash behavior automatically.
The show can contain flashing lights, camera shake, and sudden cuts.
Playback controls fade after inactivity; tap the canvas to bring them back.

Lyric grounding looks up available lyrics through LRCLIB to inform section
timing and visual interpretation. It does not display the lyrics as
karaoke text. Turn it off to skip those requests; the recording's own
analysis still drives the show.

## How a song becomes a performance

The audio adapter decodes a recording and filters it into seven frequency
bands, then estimates onsets, tempo, melody and bass pitches, sustain,
harmony, and section boundaries. These become a unified `NoteEvent`
timeline and continuous energy curves.

Here, “stem separation” in the implementation means frequency-band
filtering. It is not learned instrument isolation. Pitch and role estimates
from a mixed recording are approximate; sharing a timeline format with the
MIDI adapter does not imply MIDI-level transcription accuracy.

The **Conductor** dispatches that timeline against the audio clock.
Ahead-of-time subscriptions let a performer prepare a move whose peak
lands on a note's onset. The visual clock compensates for reported audio
output latency, with the optional Bluetooth trim above. Simulation runs at
a fixed 120 Hz and rendering interpolates between steps.

Musical casting assigns clean melodic material to **Midasus**, bass to
**Broshi**, and lead material to **Midio**, with fallbacks when parts cannot
be identified. With uploaded stems, filenames and each stem's activity
help assign the notes.

The world registry contains eight base styles:

- **The Range** — alpine mountains.
- **After Hours** — a nighttime city.
- **Far Side** — a lunar landscape.
- **The Fathom** — an underwater world.
- **Redline** — a racing-inspired landscape.
- **The Foundry** — an industrial world.
- **Understory** — a forest world.
- **The Nave** — a cathedral world.

World scoring chooses a base automatically. Song features then shape
section palettes, terrain, and visual responses; there is no world-picker
step in the current upload flow. Scenery includes layered ridges, weather,
celestial bodies, particles, and other effects where supported by the
chosen style. Repeating musical sections can return to recognizable visual
identities.

The parallax ranges are laid out as a timeline rather than as decoration.
Each depth travels at its own speed, so one tile of it stands for a fixed
stretch of music — roughly a song at the horizon, a section, a passage, and
a phrase at the front — and a summit sits at the point in that stretch its
moment occupies. The gaps between mountains are the gaps between events,
the wider mountains are the longer events, and a summit shows its steep
face toward whichever side the music rose or fell fastest on. Where the
recording has a tempo, the gullies striping the flanks are cut on the beat
grid, so the texture of the rock passes the eye at the song's own pulse.

Analysis bundles are cached in IndexedDB so repeat plays can reuse the
expensive analysis. Missing or unreadable cache entries fall back to fresh
analysis. The performance governor reduces optional effects under sustained
frame pressure; the low-resolution presets provide additional controls.

## Rendering and developer tools

Canvas 2D composes the scene. Add `?renderer=webgl` to the URL to enable
the optional WebGL2 post-processing overlay; unsupported browsers fall back
to Canvas.

Add `?dev=1` to enable developer shortcuts. During playback, the backtick
key opens the debug overlay, and `V` toggles the optional vision tuning
loop. That loop is off by default and needs a configured local or remote
provider. Its provider/model/endpoint settings live in the debug overlay;
external providers can require a user-supplied API key. Playback does not
require this feature.

## Repository layout

```text
index.html   Current audio-upload page and playback controls
src/
  main.js    Loading, controls, playback lifecycle, and app coordination
  core/      NoteEvent timeline, Conductor, ParamBus, MIDI utilities
  audio/     Filtering, onset/tempo/pitch analysis, caching, playback, synthesis
  lyrics/    Song identity, lyric lookup, alignment, and section interpretation
  sim/       Fixed-step choreography, companions, calibration, and effects
  world/     World registry, scoring, song-derived palettes, terrain, scenery
  render/    Canvas compositor, optional WebGL overlay, performance governor
  vision/    Optional vision tuning loop and provider adapters
  ui/        Controls, accessibility preferences, overlays, styles
test/        Main app's Node tests and fixtures
tools/       Local server, fixture generators, browser smoke checks, legacy tools
polygon/     Separate TanStack Start / React / TypeScript application
```

[Midio Polygon](polygon/README.md) is a standalone faceted-particle
experiment, with crystal, visco, shatter, and swarm modes. It has its own
dependencies and development server and does not replace the root app.

The root GitHub Pages workflow publishes `index.html`, `src/`,
`soundfonts/`, and `CNAME`. It does not run the Node bridge or deploy
`polygon/`.

## Testing

The root `npm test` command also discovers tests under `polygon/`, so
install that app's dependencies before running the full suite:

```sh
npm ci
npm ci --prefix polygon
npm test
```

To run only the main app's Node tests:

```sh
node --test "test/*.test.js" "test/*.test.mjs"
```

To score section boundaries and repeat labels against a held-out annotated
corpus, see [audio-analysis evaluation](docs/analysis-evaluation.md).

### Current browser smoke check

Install Chromium once and start the app:

```sh
npx playwright install chromium
npm start
```

In another terminal:

```sh
npm run test:smoke
# Optional server URL and artifact directory:
npm run test:smoke -- http://localhost:8080 .smoke/local
```

The check generates a deterministic 24-second PCM WAV and opens a fresh
browser context. It turns off optional lyric lookup, selects 720p, and
uploads through **Browse files**, preserving the browser gesture needed to
unlock audio. It exercises the real decoder, OfflineAudioContext filtering,
analysis, automatic world generation, and renderer.

Assertions require a populated timeline, an active recording with the
timeline synth muted, advancing audio and simulation clocks, a populated
and changing canvas, controls that wake on a canvas tap, working pause/resume
and stop controls, and no browser
errors or visible error banner. Failure exits nonzero. Optional SoundFont
discovery is stubbed to an empty library to avoid loading local user files.

Artifacts are written to `.smoke/`: `fixture.wav`, `playback.png`,
`report.json`, and a Playwright `trace.zip`; failures also attempt to
capture `failure.png`. Open a trace with
`npx playwright show-trace .smoke/trace.zip`. Set
`PLAYWRIGHT_CHROMIUM_PATH` only when using a custom Chromium executable.

An existing recording can use the same checks (choose one at least
15 seconds long):

```sh
node tools/smoke-audio.mjs path/to/recording.wav http://localhost:8080 .smoke/custom
```

CI runs the generated-fixture smoke check and uploads its diagnostics.
The other `tools/smoke-*.mjs` scripts are legacy or specialized diagnostics;
some still target removed MIDI/demo/SoundFont UI and are not the maintained
upload regression suite.

## Additional references

- [World design notes](docs/worlds.md) — design background; the current
  registry and automatic selection are described above.
- [VFX suite](docs/vfx-suite.md) — visual-system design notes.
- [Soulseek bridge notes](docs/soulseek.md) — retained backend tooling;
  the current upload page does not expose its search/connect controls.
- [SoundFont tooling](soundfonts/README.md) — retained synthesis support;
  uploaded recordings play their own audio with the timeline synth muted.
