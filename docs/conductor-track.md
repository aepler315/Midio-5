# The Conductor Track

A way to hand-author what the world does, instead of letting the engine guess
it from the audio.

You add **one extra percussion track** to your Guitar Pro project, name it
`Conductor`, and write drum notes on it. Those notes are never played — the
engine reads them the way a pit orchestra reads a conductor. Each note is a
cue: *change the biome here*, *lightning here*, *this is the drop*.

---

## Getting it in

Export **two files** from the same project and drop them on the game
**together** (multi-select, or drag both at once):

| File | What it's for |
|------|---------------|
| `song.mp3` / `.wav` / `.flac` | What you **hear**. Played back as-is. |
| `song.mid` | What you **see**. Drives every visual, and carries the conductor track. |

The recording plays; the MIDI orchestrates. The engine does no audio analysis
on this path — your MIDI already states every onset exactly, so a scored drop
loads near-instantly where the same song dropped as bare audio has to sit
through band separation and pitch tracing first.

> **Alignment:** the two files are assumed to start at the same instant, which
> is what exporting both from one project gives you. Nothing tries to detect
> or correct an offset — a sync that silently guessed wrong would be worse to
> author against than one that's always literal. If you need a delay, put
> silence at the head of the audio.

You can still drop either file on its own:

- **MIDI alone** — the synth performs it, conductor track still works.
- **Audio alone** — the old analysis path, no cue sheet.

---

## Setting up the track in Guitar Pro

1. Add a track → **Percussion**.
2. Name it exactly `Conductor` (also accepted: `Cue`, `Cues`, or anything
   starting with those words — `Conductor Track` is fine).
3. Write notes on it using the drum instruments in the table below.
4. Mute it in your DAW/GP mix if you like — the engine ignores it either way.

The track never reaches the timeline, the note chart, the casting, or the
synth. It cannot be heard and cannot be jumped on. Ordinary drum tracks
sitting next to it are completely unaffected.

You can have several conductor tracks; they're merged into one cue sheet.

---

## The schema

Two axes, both of which Guitar Pro gives you natively:

- **Which drum** you write = **which cue**
- **How loud** you write it (`ppp`…`fff`) = **that cue's parameter**

Guitar Pro's eight dynamic marks map one-to-one onto eight parameter slots,
so "mezzo-forte crash" is a precise, repeatable instruction.

### Structure & big moments — the cymbals

| Drum | MIDI | Cue | Dynamic controls |
|------|------|-----|------------------|
| Crash Cymbal 1 | 49 | **Section boundary** — a new section starts here | `ppp–p` fade · `mp–f` cut · `ff–fff` shutter |
| Crash Cymbal 2 | 57 | **Drop** — hype surge + a trio flourish | strength |
| Chinese Cymbal | 52 | **Apotheosis** — force the gold mode | — |
| Splash Cymbal | 55 | **Flourish** — the trio's disc spin | — |
| Ride Cymbal 1 | 51 | **Calm** — drop into a calm passage (~6s, then eases out) | depth |
| Ride Bell | 53 | **Key change** — palette rotation + mandala reseed | — |

### Sky — the hi-hats and shaker

| Drum | MIDI | Cue | Dynamic controls |
|------|------|-----|------------------|
| Open Hi-Hat | 46 | **Meteor shower** | volley size |
| Pedal Hi-Hat | 44 | **Lightning strike** | — |
| Cabasa | 69 | **Weather** | `ppp` rain · `pp` snow · `p` petals · `mp` embers · `mf` sunshine · `f` fog · `ff–fff` wind |

### Camera & heat — the toms and tambourine

| Drum | MIDI | Cue | Dynamic controls |
|------|------|-----|------------------|
| Low Floor Tom | 41 | **Camera shake** | strength |
| Low Tom | 45 | **Ground pulse** — shockwave through the terrain | strength |
| Tambourine | 54 | **Fever spark** | strength |

### Biome — the woodblocks

Pick the biome for whichever section the note lands in. Three drums × eight
dynamics addresses all seventeen profiles.

| Drum | MIDI | `ppp` | `pp` | `p` | `mp` | `mf` | `f` | `ff` | `fff` |
|------|------|-------|------|-----|------|------|-----|------|-------|
| Claves | 75 | TWILIGHT | EMBER | ARCTIC | JADE | VOID | SAKURA | SOLAR | STORM |
| Hi Wood Block | 76 | MIRROR | CYBER | ABYSS | DUNE | CORAL | LUMEN | AURUM | NEBULA |
| Low Wood Block | 77 | GEODE | — | — | — | — | — | — | — |

---

## How cues interact with the engine's own reads

The engine always analyses the song for structure, biomes, drops, and mood.
**Your cues win.** Everything it inferred is a guess about a particular song
and can be wrong; a cue is not a guess.

Concretely:

- A **section cue** cuts a boundary wherever you wrote it, snapped to the
  nearest bar line. The new section still *inherits* everything the analysis
  worked out about that moment (its form label, hue bias, lyric read) — you're
  overriding where the boundary sits and how it transitions, not throwing away
  the rest.
- A **biome cue** overrides the profile of the section containing it.
- **Live cues** (everything else) bypass the probability rolls and thresholds
  their music-driven equivalents go through. A splash you wrote always spins;
  a bolt you wrote always strikes, at any dynamic.

Hard floors that exist for *physical* reasons still apply — a flourish won't
restart in the middle of the spin it's already doing.

Two authoring conveniences worth knowing:

- A drum **not** in the tables above is simply ignored, so you can sketch on
  the cue track without breaking the load.
- Boundaries written closer together than ~700ms collapse into one, so a
  slipped note doesn't produce unreadable section slivers.

---

## Scrubbing

The mountain seekbar works normally. Scrubbing **backward** makes the cues you
passed live again; scrubbing **forward** skips the ones you jumped over, since
they belong to a moment that didn't happen.

---

## Where this lives in the code

| File | Role |
|------|------|
| `src/core/ConductorTrack.js` | The schema: pitch→cue, velocity→parameter, and the section-plan fold. Pure. |
| `src/core/MidiAdapter.js` | Diverts the track before anything musical touches it. |
| `src/sim/CueDirector.js` | Forward-only dispatch of live cues, plus the seek contract. |
| `src/sim/Simulation.js` | `_applyCues` — one arm per cue kind into the engine. |
| `src/world/BiomeManager.js` | Applies the schedule cues over its detected plan. |

Tests: `test/conductorTrack.test.js`, `test/cueDirector.test.js`,
`test/cueWiring.test.js`.

To add a cue: add a `CueKind`, a pitch in `CUE_BY_PITCH`, a `cueValue` case if
it takes a parameter, and an arm in `Simulation._applyCues`.
