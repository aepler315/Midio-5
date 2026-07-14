# Super Midio World

A framework-free, audio-clock-mastered rhythm side-scroller. Drop in a MIDI
file or an audio file (mp3/wav/flac) and the entire show — jumps, combos,
two companions, eight parallax biomes, screen fracturing — is generated live
from the music, no authored levels involved. Canvas 2D + Web Audio API only.

Full design spec: see the original technical specification this repo
implements (MIDI/audio adapters unify into one NoteEvent timeline; every
visual system is a pure consumer of it).

## Running it

No build step. Any static file server works:

```sh
npm install   # only pulls in Playwright, for the test harness below
npm start     # serves the app at http://localhost:5173
```

Then open `http://localhost:5173` and either drop a `.mid`/audio file, or
click **"Play procedural demo"** to run with zero file input. **You can drop
a different `.mid`/audio file in at any time, even mid-song** — dragging one
anywhere on the page (not just the loader screen) tears down whatever's
currently playing and starts the new one immediately.

**Note highway & tap densities:** vertical bars glide in from the right and
cross Midio's hit line when you should tap (`Space`, click, or touch). Gold
bars are jump-aligned (kick onsets). Pick **Easy / Medium / Hard** on the
loader or in the HUD:

| Density | Pattern |
| --- | --- |
| Easy | Metronome quarters — 1 · 2 · 3 · 4 |
| Medium | Bass-drum (kick) hits **plus** the quarter grid |
| Hard | Excited dual-thumb density: kicks + 16th-note drive around the bass + rhythm onsets |

**Audio files** play the decoded buffer only — the synthetic hi-hat / click
layer from the timeline synth is muted so it doesn't stack on the song. MIDI
and the procedural demo still use the synth / SoundFont. Perfect hits play a
coin-style chime (and other short SFX) synthesized in the Web Audio graph.

**Fullscreen:** use the HUD fullscreen button (⛶) for immersive play.

**MIDI → custom biome:** every dropped/uploaded `.mid` file also generates a
unique biome profile (palette, particles, FX) from its pitch-class histogram,
velocity, density, and role mix, and casts the whole song into that world.
Stock demos keep the dramaturgical 9-biome cast.

**Optional WebGL path:** open with `?renderer=webgl` to enable a non-destructive
WebGL2 post-FX overlay (energy-driven tint/vignette). The Canvas 2D compositor
always draws the scene; WebGL never steals the stage canvas context. If WebGL
is unavailable, the path falls back to pure Canvas automatically.

**MIDI files with many tracks/channels are fully supported** — including
SMF Type 0 files that multiplex several instruments through one track,
which get split back out into one voice per channel. During play, a small
**"N tracks · M roles"** badge appears top-right of the HUD; click it (or
press `T`) to see every track's name, role, note count, and stereo pan. Any
pair of tracks that were mixed hard-panned to opposite sides *and* actually
play together gets a ↔ marker: their stereo spread starts centered and
eases out to the full authored pan by the end of the song, instead of
jumping straight to full width on note one.

**SoundFonts (`.sf2`)** give MIDI playback real sampled instruments instead
of the built-in oscillator synth. Drop `.sf2`/`.zip` files into the
`soundfonts/` folder next to `index.html` and refresh — `npm start`'s dev
server auto-loads everything in there, no clicking required (see
`soundfonts/README.md`). You can also load fonts manually from the title
screen or from the switcher popup below (file picker, folder picker, or
`showDirectoryPicker` on supporting browsers). The pill at the bottom shows
the active font's name; click it (or press `F`) to open the **switcher
popup** listing every loaded font — click a row to make it active, or the
`×` to hide it (excluded from the rotation, but never deleted). Hidden fonts
come back through the **settings gear** (top-right of the HUD) or the
popup's "Hidden (n)" link, which lists them with a `+` to restore. Robust
against real-world fonts: preset lookup falls back gracefully instead of
dropping notes when a font is missing the exact program/bank a role
expects, stereo instrument pairs authored via SF2's sample-link mechanism
(rather than two explicitly-panned zones) still play both channels, and a
track's own hard pan blends with — rather than fighting — the font's
authored stereo spread.

Press `` ` `` during play to open the debug overlay (ParamBus state + vision
loop log); press `V` inside it to toggle the vision self-tuning loop (off by
default — it calls out to a local Ollama instance at
`http://localhost:11434`, and degrades to a silent no-op if that's not
running). Press `Escape` to close any open popup.

## Project layout

```
src/
  core/      NoteEvent timeline, MIDI parser/adapter, Conductor, ParamBus
  audio/     7-band stem separation, onset/BPM detection, audio adapter
  sim/       fixed-step simulation: jump physics, combo, companions, FX
  world/     biomes (8-layer parallax) and the fracture/shatter engine
  render/    canvas compositor + camera
  vision/    Ollama-backed closed-loop self-tuning
  ui/        debug overlay, styles
test/        node --test unit tests (pure logic, no DOM needed)
tools/       dev server, WAV/MIDI test-fixture generators, Playwright smoke tests
```

## Testing

```sh
npm test                    # pure-logic unit tests (node --test)
node tools/serve.js &       # then, for visual/E2E smoke tests:
node tools/smoke.mjs                 # demo playthrough screenshot sequence
node tools/smoke-audio.mjs <wav>     # drives a real audio file through the full pipeline
node tools/smoke-fracture.mjs        # exercises crack growth -> terminal shatter directly
node tools/smoke-vision.mjs          # debug overlay + vision loop toggling
node tools/smoke-full.mjs <mid>      # every system together on a real MIDI file
node tools/gen-test-wav.mjs <out.wav> <bpm> <seconds>   # synthesize a test click track
node tools/gen-test-midi.mjs <out.mid> <bars>           # synthesize a multi-track test MIDI file
node tools/smoke-soundfont.mjs               # SF2 loading, switching, and routing
node tools/smoke-multitrack.mjs              # multi-channel voices, pan-out, soundfont auto-load
node tools/smoke-hotswap.mjs                 # drag a different MIDI in mid-song; no duplicate listeners/frame loops
node tools/smoke-fontswitcher.mjs            # switcher popup: select/hide/unhide, settings view
```

`OfflineAudioContext` (used for stem separation) only exists in a browser,
so the audio-pipeline tests run against a real Chromium via Playwright
rather than Node's test runner.

## Build order

The system was built in the dependency-safe order the spec lays out — each
stage lands as a playable increment:

1. MIDI parsing + tempo map + unified timeline + Conductor
2. Fixed-step loop + three-phase jump curve
3. Impact FX + combo system + telegraph anticipation
4. Raw-audio pipeline (stem separation, onsets, BPM/phase)
5. Companions (Midasus the fairy, Broshi the raptor)
6. Biome system (8-layer parallax, 8 profiles, crossfade)
7. Progressive fracturing + terminal shatter
8. ParamBus + vision self-tuning loop + debug overlay
