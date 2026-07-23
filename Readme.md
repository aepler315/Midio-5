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

**Watch it perform itself:** Midio performs the song himself — every jump,
double-jump, and double-bass slide is played flawlessly, on the beat,
automatically. There's nothing to fail and nothing to steer: the camera
holds one fixed, cinematic framing (all zoom — the old player "Lens" and the
automatic beat-zoom alike — has been removed), so you can sit back and take
in the whole show. The one thing that still notices you is **Midasus's three
star children**: move your mouse and the hyper-curious explorer drifts toward
your cursor — they're aware you're there (see below).

**Audio files** play the decoded buffer only — the synthetic hi-hat / click
layer from the timeline synth is muted so it doesn't stack on the song. MIDI
and the procedural demo still use the synth / SoundFont. A dropped audio file
also looks its lyrics up (from LRCLIB) to *shape the visuals* — song
structure and emotion feed the world's intensity; the words are never drawn
on screen. If a song has no lyrics, or you'd just rather skip the search,
there's a **"No lyrics" toggle** on the loader (and in the lyric prompt); it's
remembered, and when it's on the whole fetch is skipped. **The audio
analysis now reaches MIDI parity:** beyond onset/tempo detection, the
pipeline runs real pitch tracking on the samples themselves — FFT peak
tracking (leakage-safe, parabolic-refined) gives melody notes their true
pitches, time-domain autocorrelation over the isolated bass stem recovers
bass fundamentals, note durations are measured from each onset's actual
sustain, and every bar's strongest chroma classes are emitted as PAD chord
events. So the systems that listen to pitch — Midasus's pitch-mapped
flight, Broshi's melody-height hops, the valence/tonic vibe reads, key-
change waves — behave the same on an mp3 as on a .mid.

**The casting (who dances what):** the trio are not generic dancers — each
answers to an instrument, and the file itself decides the delegation.
**Clean melodies** (piano, clean/acoustic guitar, mallets, harp) go to
**Midasus**, **the bass line** goes to **Broshi** (he hops it with his
whole body, and his trailing spring genuinely loses damping on ice), and
**lead melodies that aren't clean** (synth leads, driven guitars, horns)
go to **Midio**, whose takeoff heights and mid-air extra beats ride that
line. MIDI files are cast from track names and GM programs; a single audio
file is cast spectrally (a note whose centroid rides far above its own
fundamental is a lead, one that stays near it is clean); and dropping
**several audio stems at once** (`bass.wav`, `piano.wav`, `lead.wav`…)
casts by FILENAME, with each stem's live loudness deciding which stem owns
each note. The track badge shows the verdicts; timelines with no casting
information keep the old wiring, so nothing ever starves.

**Anticipatory choreography (the timing method):** character moves don't
react to the beat — they *arrive* on it. Because the full note timeline
exists up front, the Conductor has an ahead-of-time dispatch channel that
hands characters their notes early, and every move envelope is anchored so
its **peak** — a hop's apex, a flash's full brightness — lands exactly on
the note's own onset, the way a dancer starts a move before the beat to
hit it. On top of that, all decorative envelopes evaluate on the *heard*
clock: the AudioContext's reported output latency (10–30 ms on speakers,
200 ms+ on Bluetooth) is subtracted, so the peak lines up with the sound
reaching your ear, not the DSP scheduler. And the envelopes are closed-form
functions of (now − onset) rather than per-tick integrations, so their
shape is exact at any frame rate — no 8 ms sim-step quantization, and the
kick flash is literally the same `kickEnv` curve the mountain ranges
bounce with: one choreography, sample-accurate.

**The heavens are populated:** each biome hangs its own seeded planets in
the sky — banded, ringed, cratered, crescent — colored from that world's
palette, breathing faintly with the groove. And on a rare seeded schedule
(a handful per song, deterministic per file), astral artifacts pass
through: a comet crossing, a moon eclipsing a planet with a diamond-ring
flare, a blinking satellite, an aurora ribbon, a pair of shooting stars
(reduced-flash safe).

**Weather has consequences now:** snow that actually falls for a while
**settles** — frost caps build on the terrain with specular glints sliding
underfoot — and settled snow means **slippery surfaces**: hard landings
skid (a bounded, render-only slide, so the autoplay's clearance guarantee
is untouched) with a powder puff at the boots, Broshi overshoots his
formation point and slides back, and inherently frozen biomes are icy from
the start. Weather fronts also gust the global wind now, so rain and snow
arrive with weather rather than into still air.

**Look far into the distance:** every so often, way out between the
farthest ranges — partially hidden behind nearer ridges — something
strange is quietly going on: aliens having dinner under their parked
saucer (one raises its fork right on the kick), two robots slow-dancing
under a blinking heart, a whale surfacing from the cloud sea, a great
turtle carrying a tiny lantern city, an observatory tracking the
celestial. Seeded per song and anchored to world position, so the same
file always hides the same scenes in the same places.

**Fullscreen:** use the HUD fullscreen button (⛶) for immersive play.

**Every song → its own world:** every dropped/uploaded file — `.mid` OR
audio — generates a unique biome profile (palette, particles, FX) and casts
the whole song into that world; only the stock demos keep the dramaturgical
9-biome cast. The visual fingerprint reads four layers of the song:
**tonality** (the chroma-derived tonic sets the hue; the major/minor
balance — a 24-key Krumhansl template match on audio, third-balance on
MIDI — tilts the whole palette radiant or somber, minor keys drifting
cooler), **energy** (density + velocity + kick drive set the temperature),
**texture** (spectral brightness lifts the sky's hot band, high dynamic
range earns the neon ridge line, stereo width airs out the particle
field), and **orchestration** (the melody/rhythm/bass/pad mix picks the
particle species).

**The chorus is a place:** the world now recognizes song *form*. Sections
are cut at energy-novelty boundaries as before, but each is then labelled
by its timbral fingerprint (a cosine-similarity clustering of its mean
7-band spectral shape — see `SongForm.js`), so a returning chorus gets the
same structural label as its earlier selves. Every recurrence of a label
wears the same face: on the stock 9-biome demo it casts back to the *same*
biome (and, since strips and landmarks bake per biome name, the returning
skyline is literally identical); on a dropped single-biome song each label
carries a deterministic signature hue-shift, so the chorus always blooms
the same color and the verse always another, gliding between them and
snapping back with a cut of recognition when a familiar section returns.

**The whole frame catches light:** a final bloom pass now runs over every
composed frame — the composited scene is downsampled, crushed to its own
highlights, blurred, and added back additively, so bright sources genuinely
bleed light into the world instead of stopping hard at their own edges (the
sun's corona, a character's glow, kick flashes, the aurora, all reading
naturally tinted by their own color). It's music-reactive: a steady base
glow at rest, swelling on drops, kick slams, and fever, tamed (never
removed) under reduced-flash. A subtle film-grade wash and vignette close
out the post stack. Sheds automatically under sustained frame pressure
(`PerfGovernor`).

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

**Watch it perform itself:** Midio's autoplay engine walks the same
offline-predicted takeoff schedule the world's obstacles are placed
against, so every jump always lands and every double-bass roll is always
ridden clean — there's nothing to fail. The jump itself now has a tighter,
more satisfying shape — a snappier launch, a longer float that visibly hangs
at the apex on the beat, and a crisper drop — plus a deeper pre-jump wind-up
and a landing "stick" that hits right on the beat. Alongside the ambient
obstacles, a **geometric family** (triangles, squares, hexagons) now spawns
**lined up in a row** across a single jump arc: Midio takes off on that arc's
kick, sails over the whole formation, and lands on the next kick. Every shape
sits inside the arc's proven-safe clearance window, so the row is worst-case
clearable exactly like a single obstacle. A jump queued **before the
character hits the ground is a double jump** — a C0-continuous relaunch
from the current height — but not forever: the air-jump budget is paced by
the song's *phrase structure*. The analysis engine autocorrelates the
per-bar energy profile at 4- and 8-bar lags to decide whether the song
phrases in 4s or 8s, and the budget (2 per 4-bar phrase, 4 per 8-bar)
refills on each phrase boundary, with each successive air jump in a phrase
a little smaller until the last one — the flourish — spikes. A *fever
meter* still multiplies the flawless performance's own steadiness by the
song's live energy, and everything downstream — judgment particle bursts,
phenomena intensity, meteor volleys, and the mountain dance amplitude (up
to ~2.8×) — rides it: a lullaby stays elegant, a drop goes insane.

**The trio went fully stellar:** the design language converged on Midasus —
the star was perfect — so Midio and Broshi now wear her whole treatment, not
just her silhouette language. Both keep their own forms (Midio the five-spike
star-hero, Broshi the raptor with snout/jaw/tail/tongue rig intact), but both
now carry her **pale, pitch-class spectral color** — Midio's hue tracks the
song's key, Broshi's tracks his own hop line — over a brighter stellar
under-glow, a breathing pulse, and her additive note **slashes** on hard
hits. Broshi's old green→red raptor skin is gone: rabid now reads as heat
(whiter, hotter), not a color change. The stage itself grew: the ground band
is shorter, the sky taller, jumps arc higher, and everyone's drawn bigger.
Midasus's **three baby stars** still treat her as a secure base — exactly one
at a time ventures out, the others stay safe — but they're now **hyper
curious**: the explorer ventures readily and often, ranges far, and hops
between points of interest mid-trip (Midio, Broshi, the nearest obstacle, and
**your cursor** — they're aware of you). They render at the **same intensity
as the mains** (a spectral glow halo breathing with Midasus's pulse, a
stardust trail), rush home the moment the song turns loud, and every so often
one **whispers a small fourth-wall line** — aware it's a digital artifact,
and aware of the person watching.
Meanwhile **miniature versions of all three characters run along the
background mountain ridges** — riding the exact same ridge wave the
mountains dance with, hopping on the layer-delayed kick, and sprinting
faster as the fever climbs. **Broshi now moves to the melody** (his hops
trigger on melodic onsets, sized by how high the note sits in the tune)
while **Midio's jumps ride the bass line** — the chart's own flawless
takeoff schedule stays intact, but bass energy makes a jump bigger, and a
busy bass line can pop him an extra beat mid-air (guarded so it never
risks a clean landing).

**The world plays along:** every parallax range dances — a groove-scaled
traveling wave rolls along each ridge, and kicks bounce the hills, near
layers first, far peaks a beat-fraction later. Behind them all sits one
super-distant massif whose skyline IS a live bar graph of the current
7-band spectrum (bass builds the summit at the center, treble falls away
to the flanks), haze-tinted and on the slowest scroll in the scene.
**Orogeny:** every range visibly builds across the song — far peaks
grow the most — toward the track's own energy climax, then subsides back
down through the rest of the runtime, geology on a song's timescale. The
ground itself keeps chasing the music's live band levels rather than a
one-shot snapshot, breathes with a slow groove wave between individual
hits. Every impact now lands harder: screen shake is bigger and rings longer
(a global gain plus a longer decay, tamed under reduced-flash), and the
biomes are more dramatic across the board — taller, jaggier ranges that dance
harder and build more, deeper haze, stronger wind, more frequent and brighter
lightning, and a more luminous, deeper-vignetted frame. The Mario-Paint composer
strip keeps its icons spread across the whole page even on dense,
velocity-clamped MIDIs (time-stratified icon budget), and the trio's stage
presence runs deeper: Midio's trick book grows with the heat of the run
(corkscrew, tuck-pop, 720 helicopter, double flip) plus a milestone
victory dance and landing pirouettes; Broshi barrel-rolls his hard hops,
coils into a pounce when a surge starts, and chases his own tail when
things stay calm; Midasus picks a fresh rest-flight figure every time the
melody rests (figure-8s, loop-the-loops, a petaled rose) and pirouettes on
hard accents.

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
  sim/       fixed-step simulation: jump physics, combo, companions, FX, autoplay
  world/     biomes (8-layer parallax), fracture/shatter engine
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
