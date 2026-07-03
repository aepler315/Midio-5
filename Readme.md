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
click **"Play procedural demo"** to run with zero file input.

Press `` ` `` during play to open the debug overlay (ParamBus state + vision
loop log); press `V` inside it to toggle the vision self-tuning loop (off by
default).

The vision loop is provider-pluggable. Configure it from the **"Vision
provider settings"** panel on the start screen: pick a provider, paste an API
key, and optionally override the base URL / model. Supported providers:

- **Ollama (local)** — default, no key needed; calls `http://localhost:11434`.
- **OpenAI** / **OpenRouter** — Bearer-auth chat completions.
- **Anthropic** — `x-api-key` Messages API.
- **Google Gemini** — `x-goog-api-key` generateContent API.

Settings persist to `localStorage` (`smw.vision`) and hot-apply to a running
loop with no reload. The API key is stored in cleartext in the browser and sent
only to the chosen provider. Cloud providers call their API directly from your
browser. The loop is fail-safe: any provider that's unconfigured (no key) or
unreachable degrades to a silent no-op, never a crash or a stuck game.

**CORS note:** the Anthropic adapter sends
`anthropic-dangerous-direct-browser-access: true` (the sanctioned bring-your-own-key
header that enables browser CORS). OpenAI and Gemini already permit browser
origin calls. If the vision log shows an HTTP 403/CORS error, the most common
cause is an org-level CORS restriction on the account — there's nothing the app
can do from the browser; use a different provider or a key without that
restriction.

## Project layout

```
src/
  core/      NoteEvent timeline, MIDI parser/adapter, Conductor, ParamBus
  audio/     7-band stem separation, onset/BPM detection, audio adapter
  sim/       fixed-step simulation: jump physics, combo, companions, FX
  world/     biomes (8-layer parallax) and the fracture/shatter engine
  render/    canvas compositor + camera
  vision/    Provider-pluggable closed-loop self-tuning (Ollama/OpenAI/OpenRouter/Anthropic/Gemini)
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
node tools/smoke-vision-providers.mjs # provider settings form + fail-safe no-key (browser/Playwright)
node tools/smoke-full.mjs <mid>      # every system together on a real MIDI file
node tools/gen-test-wav.mjs <out.wav> <bpm> <seconds>   # synthesize a test click track
node tools/gen-test-midi.mjs <out.mid> <bars>           # synthesize a multi-track test MIDI file
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
