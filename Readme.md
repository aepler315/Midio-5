# Super Maudio World

Drop a song, pick a world, watch it play itself. Super Maudio World is a
browser music visualizer with an automatically choreographed cast, moving
scenery, and musical effects. The recording supplies the sound; its
analysed rhythm, pitch, energy, and structure drive the performance. Each
world keeps its own look and listens to that analysis in its own way.

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

1. Drop an audio file anywhere on the page, choose **Browse files**, or
   pick a music folder once and play from your library (see below).
   The picker accepts MP3, WAV, FLAC, OGG, M4A, AAC, and other audio formats
   your browser can decode.
2. Wait while the recording is pulled apart: frequency bands, onsets,
   tempo, pitch, and section structure become one song profile.
3. Choose a world. Every card is equal. Preview the **same** quiet stretch
   and the **same** peak in each world, then **Play**. **Choose for me**
   is optional and never ranks the cards. **Cathode** is always a hand pick.
4. Watch the performance. Midio plays himself; there is no movement control
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

## Your music library

**Use a music folder** remembers a folder you choose, so a returning visit
opens on your own music instead of an empty dropzone. Nothing is uploaded
and nothing is copied: the browser hands the page a durable reference to a
folder already on your disk, and a file is read only when you play it.

The library sorts by title, artist, album, folder, date added, last played,
play count or length; filters as you type (`artist:radiohead`,
`folder:"kid a"`, or just words, which also match the path); and switches
between one flat list and the folders as they are on disk. **Auto-tag**
fills in titles and artists for tracks that only have a filename, using the
free MusicBrainz API at the one request per second it asks for.

Chromium-based browsers can reopen the folder by themselves. Firefox and
Safari cannot, so there the listing is remembered and the folder is picked
again once per visit before anything plays from it. Where the browser has no
storage at all, there is simply no library and dropping a song still works.

See [docs/library.md](docs/library.md) for the details.

## Saving a video

The show can be recorded to a file: the record dot in the HUD captures from
wherever you are, and **Save a video** on the complete screen replays the
song and records it end to end. Picture and sound come out in one file, in
sync, with no mirroring or projection in between.

Presets cover 480p, 720p and 1080p, plus **Car display** (800×480) for a
double-DIN head unit, letterboxed rather than stretched. Chrome and Edge
produce H.264 MP4, which plays anywhere; Firefox produces WebM and some
Chromium builds produce VP9 in an MP4 wrapper, neither of which most car
stereos or TVs will decode. The app checks the finished file and tells you
which one you got rather than trusting the extension.

Recording runs in real time — a four-minute song takes four minutes.

See [docs/video-export.md](docs/video-export.md) for the details.

## Controls and preferences

| Control | Effect |
| --- | --- |
| Pause / Resume | Freeze or continue the performance and audio together |
| Stop | Stop playback and return to the upload screen |
| Fullscreen button | Expand the performance |
| **Record** (HUD dot) | Record the show to a video file from this moment; press again to stop and save |
| **Save a video** (complete screen) | Replay the song with the same seed and record it start to finish |
| **Use a music folder** / **Change folder** | Choose the folder your library reads from; remembered between sessions |
| **Browse library** | Open the library: search, sort, folder view, auto-tag. `Esc` closes it |
| **Timed lyric grounding: on/off** | Enable or skip lyric lookup; remembered between sessions |
| Stage selector | Choose the render resolution, including 8-bit and 8-bit intensive presets |
| Frame-rate selector | Cap rendering at 30 or 60 fps |
| **BT** chip | The Bluetooth delay, set by **Sync** or typed in by hand. Fades with the rest of the HUD; held open while its editor is |
| **Sync** button or `C` | Tap along with what you hear; the Bluetooth delay follows your taps, live ([docs](docs/sync-calibration.md)) |
| `F` / `J` | Tap the low / high percussion parts for groove calibration |
| `R` | Toggle reduced flashes, shake, and cuts |
| `P` | Toggle the FPS display |
| `T` | Toggle track details when available |
| `F3` | Toggle section labels on the mountain seekbar |

On a car head unit, the first tap after a long idle gap is spent entirely on
waking the display and restoring fullscreen, never on a control; a screen
wake lock is held while a song plays. See [car mode](docs/car-mode.md).

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
timeline, continuous energy curves, and one shared **song profile**.
Worlds do not invent their own summaries of the mix. Pulse confidence and
free-time are kept separate from BPM, so a missing beat never becomes a
fake tempo.

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

The world registry contains nine styles. Eight are painterly landforms.
**Cathode** is a four-color CRT with its own pixel renderer.

- **The Range** — mountains that breathe with the mix.
- **After Hours** — a city that glows with the groove.
- **Far Side** — a lunar landscape. No air. Nothing softens.
- **The Fathom** — an underwater world, slow on purpose.
- **Redline** — a road that only exists at speed.
- **The Foundry** — an industrial world that only stops when the song does.
- **Understory** — a forest. Nothing is built. Everything grows.
- **The Nave** — a cathedral whose glass rebuilds with returning sections.
- **Cathode** — a machine dreaming in four colors. Manual pick only.

After analysis, the chooser shows one equal card per world, in authored
order. A **Preview** plays the same quiet or peak passage through that
world's treatment of the song. **Play** adapts palette, terrain, and
musical response for the selected world — alpine never grows a city, and
a dense mix is filtered rather than amplified. There is no privileged
“custom” card and no public score.

**Choose for me** uses a private post-adaptation fit: would this world's
response sit in a sweet spot for this song, without clipping into noise.
Ties stay ties. Cathode and any explicit exclusion stay out of that pick.
The number is never shown on the cards.

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
analysis. Older bundles without a song profile still play; the profile is
rebuilt from the unpacked analysis. The performance governor reduces
optional effects under sustained frame pressure; the low-resolution
presets provide additional controls.

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
index.html   Current audio-upload page, world chooser, and playback controls
src/
  main.js    Loading, chooser, playback lifecycle, and app coordination
  core/      NoteEvent timeline, Conductor, ParamBus, MIDI utilities
  audio/     Filtering, onset/tempo/pitch analysis, song profile, caching, playback
  lyrics/    Song identity, lyric lookup, alignment, and section interpretation
  sim/       Fixed-step choreography, companions, calibration, and effects
  world/     World registry, adaptation, private fit, palettes, terrain, scenery
  eval/      Private world-quality corpus (no audio, no public scores)
  render/    Canvas compositor, optional WebGL overlay, performance governor
  vision/    Optional vision tuning loop and provider adapters
  ui/        Controls, world chooser, previews, accessibility, overlays, styles
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

The main app suite:

```sh
npm ci
npm test
```

`npm test` runs the Node tests under `test/` (`test/*.js`, `test/*.mjs`,
and `test/helpers/*.js`). It does not walk `polygon/`. To also discover
nested packages:

```sh
npm ci --prefix polygon
npm run test:all
```

To score section boundaries and repeat labels against a held-out annotated
corpus, see [audio-analysis evaluation](docs/analysis-evaluation.md).

To review whether worlds actually look good — same quiet / transition / peak
in every world, scores hidden — see
[world quality evaluation](docs/world-quality-evaluation.md).


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
analysis, the world chooser (nine equal cards, no privileged custom card),
and the renderer after a world is picked.

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

Car mode (wake lock, wake-up-tap absorption) has its own check against a
running server:

```sh
npm run test:car
```

CI runs the generated-fixture smoke check and uploads its diagnostics.
The other `tools/smoke-*.mjs` scripts are legacy or specialized diagnostics;
some still target removed MIDI/demo/SoundFont UI and are not the maintained
upload regression suite.

## Additional references

- [World design notes](docs/worlds.md) — design background; the current
  registry, chooser, and per-world musical responses are described above.
- [VFX suite](docs/vfx-suite.md) — visual-system design notes.
- [Car mode](docs/car-mode.md) — keeping a head-unit display awake and in
  fullscreen, and why a page cannot fake a tap.
- [Soulseek bridge notes](docs/soulseek.md) — retained backend tooling;
  the current upload page does not expose its search/connect controls.
- [SoundFont tooling](soundfonts/README.md) — retained synthesis support;
  uploaded recordings play their own audio with the timeline synth muted.
