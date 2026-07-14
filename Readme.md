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

**Per-song SoundFont recommendation:** the same font can be perfect for one
MIDI and dead silent for the next (missing programs, drum-kit-only banks,
broken root keys) — the MIDI file is the volatile variable. So every time a
`.mid` loads, each loaded font is *auditioned against that song* in the
background: a coverage-maximizing excerpt of the actual timeline plus one
isolated loud/soft probe note pair per track are rendered through the font
offline, and the output is analyzed. Hard rules disqualify fonts that
render silence, only onset-aligned percussive spikes where sustained notes
were scored, pitched content octaves away from what the MIDI asks, or heavy
clipping; survivors get a 0–100 fit score from track coverage, pitch
accuracy, sustain quality, loudness, level balance, velocity response,
timbre distinctness, and spectral liveliness. The engine auto-activates the
best fit (bailing out of a disqualified active font the moment its verdict
lands — to the built-in synth if nothing qualifies), badges every row in
the switcher popup (★ best fit, numeric score, ⚠ + reason), and never
overrides a font you picked by hand for the current song. When fonts are
loaded, the ratings **gate the start of the song** (offline renders on the
main thread used to lag gameplay badly): a loading screen plays a
hyper-simplified rendition of *this song's* percussion — its kicks
distilled to thumps with the in-between hits demoted to soft hats, looping
under a pulsing star — until the verdicts land and the best fit takes the
stage. A new file dropped during the gate cancels it cleanly; with no
fonts loaded there is no gate at all.

**Play it, don't just watch it:** tap Space (or click/touch) on the bass
drum to jump. A tap **before the character hits the ground is a double
jump** — a C0-continuous relaunch from the current height — but not
forever: the air-jump budget is paced by the song's *phrase structure*.
The analysis engine autocorrelates the per-bar energy profile at 4- and
8-bar lags to decide whether the song phrases in 4s or 8s, and the budget
(2 per 4-bar phrase, 4 per 8-bar) refills on each phrase boundary, with
each successive air jump in a phrase a little smaller until the last one —
the flourish — spikes. And the visuals follow *you*: a *fever meter*
multiplies steady, accurate tapping (tight offset clustering, high tiers)
by the song's live energy, and everything downstream — judgment particle
bursts, phenomena intensity, meteor volleys, and the mountain dance
amplitude (up to ~2.8×) — rides it. Sloppy taps through a drop stay tame;
perfect taps through a lullaby stay elegant; both together go insane.

**Latency is measured, never blamed:** the first session ever opens with a
one-time **calibration screen** — tap along with a bare metronome and the
median bias becomes your stored input offset (skippable). From then on the
in-game calibrator watches judged offsets silently: a player who is steady
between beats but always ~30ms late is reading pipeline latency, not
sloppiness, so the bias is cancelled automatically (jittery windows are
left alone — that's the player) and persisted across sessions.

**The trio went stellar:** the design language converged on Midasus — the
star was perfect — so Midio is now a five-spike star glyph (crown, two
shoulders, two ground-spike feet) and Broshi a low comet-star raked hard
forward, both still wireframe instruments of the same deformation-driven
glow. Midasus gained **three baby stars** that treat her as a secure base:
they orbit close, exactly one at a time ventures out to explore in calm
stretches (Midio is their favorite point of interest), and they rush home
the moment the song turns loud. Meanwhile **miniature versions of all
three characters run along the background mountain ridges** — riding the
exact same ridge wave the mountains dance with, hopping on the
layer-delayed kick, and sprinting faster as the fever climbs.

**The world plays along:** every parallax range dances — a groove-scaled
traveling wave rolls along each ridge, and kicks bounce the hills, near
layers first, far peaks a beat-fraction later. Behind them all sits one
super-distant massif whose skyline IS a live bar graph of the current
7-band spectrum (bass builds the summit at the center, treble falls away
to the flanks), haze-tinted and on the slowest scroll in the scene. The
Mario-Paint composer strip keeps its icons spread across the whole page
even on dense, velocity-clamped MIDIs (time-stratified icon budget), and
the trio's stage presence runs deeper: Midio's trick book grows with the
heat of the run (corkscrew, tuck-pop, 720 helicopter, double flip) plus a
milestone victory dance and landing pirouettes; Broshi barrel-rolls his
hard hops, coils into a pounce when a surge starts, and chases his own
tail when things stay calm; Midasus picks a fresh rest-flight figure every
time the melody rests (figure-8s, loop-the-loops, a petaled rose) and
pirouettes on hard accents.

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
node tools/smoke-recommend.mjs               # per-MIDI font audition: hard DQs, auto-rescue, badges, pinning
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
