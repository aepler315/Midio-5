// The conductor track: a percussion track the player authors in Guitar Pro
// (or any MIDI editor) that is NEVER sounded. The engine reads it the way a
// pit orchestra reads a conductor -- each percussion note is a cue telling
// the show what to do at that instant, not a note to play.
//
// Why percussion: Guitar Pro's drum editor is the one place you can drop a
// note at an exact beat without it belonging to a musical voice, and its
// per-note dynamics (ppp..fff) give a second authoring axis for free. So the
// schema is two-dimensional:
//
//   PITCH    = which cue (a GM percussion instrument, chosen so related cues
//              sit in the same instrument family -- cymbals are structure,
//              hats are sky, toms are camera)
//   VELOCITY = that cue's parameter, read as one of Guitar Pro's 8 dynamic
//              levels (see velocityBucket)
//
// Everything here is pure: no DOM, no audio, no engine imports beyond the
// biome name table. midiToTimeline calls parseConductorTrack once at load;
// BiomeManager folds the schedule cues into its section plan; CueDirector
// dispatches the live ones as the song plays.
import { BIOMES } from '../world/BiomeProfiles.js';

/** A track is the conductor guide when its NAME says so. Matched on the
 *  MIDI track name, so in Guitar Pro you just call the percussion track
 *  "Conductor" -- ordinary drum tracks alongside it are unaffected. */
export const CONDUCTOR_TRACK_RE = /^\s*(conductor|cue|cues)\b/i;

export function isConductorTrackName(name) {
  return CONDUCTOR_TRACK_RE.test(String(name || ''));
}

export const CueKind = Object.freeze({
  // --- Schedule cues: read once at load, folded into the section plan ---
  SECTION: 'section',
  BIOME: 'biome',
  // --- Live cues: dispatched at their own tMs while the song plays ---
  KEY_CHANGE: 'keyChange',
  DROP: 'drop',
  APOTHEOSIS: 'apotheosis',
  FLOURISH: 'flourish',
  CALM: 'calm',
  METEORS: 'meteors',
  LIGHTNING: 'lightning',
  WEATHER: 'weather',
  SHAKE: 'shake',
  GROUND_PULSE: 'groundPulse',
  FEVER: 'fever',
});

/** Cues consumed at build time rather than dispatched during playback. */
export const SCHEDULE_KINDS = Object.freeze(new Set([CueKind.SECTION, CueKind.BIOME]));

/**
 * GM percussion pitch -> cue kind. Grouped by instrument family so the
 * schema is learnable at the drum-editor level rather than memorized:
 *   cymbals  -> structure and big moments
 *   hats     -> sky phenomena
 *   toms     -> camera
 *   woods    -> biome selection (three banks, see BIOME_BANKS)
 */
export const CUE_BY_PITCH = Object.freeze({
  // Cymbals: structure + the big moments
  49: CueKind.SECTION,     // Crash Cymbal 1  -- a new section starts here
  57: CueKind.DROP,        // Crash Cymbal 2  -- the drop hits
  52: CueKind.APOTHEOSIS,  // Chinese Cymbal  -- force gold apotheosis
  55: CueKind.FLOURISH,    // Splash Cymbal   -- trio disc-spin flourish
  51: CueKind.CALM,        // Ride Cymbal 1   -- drop into a calm passage
  53: CueKind.KEY_CHANGE,  // Ride Bell       -- palette/key rotation
  // Hi-hats + shaker: the sky
  46: CueKind.METEORS,     // Open Hi-Hat     -- meteor volley
  44: CueKind.LIGHTNING,   // Pedal Hi-Hat    -- lightning strike
  69: CueKind.WEATHER,     // Cabasa          -- change what's falling
  // Toms + tambourine: camera and heat
  41: CueKind.SHAKE,       // Low Floor Tom   -- camera shake
  45: CueKind.GROUND_PULSE, // Low Tom        -- shockwave through the terrain
  54: CueKind.FEVER,       // Tambourine      -- stoke the fever meter
  // Woodblocks + claves: pick the biome for this section
  75: CueKind.BIOME,       // Claves          -- biome bank A
  76: CueKind.BIOME,       // Hi Wood Block   -- biome bank B
  77: CueKind.BIOME,       // Low Wood Block  -- biome bank C
});

/**
 * Guitar Pro writes its eight dynamic marks at evenly-spaced MIDI
 * velocities (ppp=15, pp=31, p=47, mp=63, mf=79, f=95, ff=111, fff=127), so
 * rounding to the nearest sixteenth recovers exactly which mark was written.
 * This reads the RAW 0-127 velocity on purpose -- the musical pipeline's
 * `velNorm` is p95-rescaled per track (MidiParser.rescaleVelocities), which
 * would smear these buckets into each other.
 * @returns {number} 1..8 (ppp..fff)
 */
export function velocityBucket(rawVel) {
  if (!Number.isFinite(rawVel)) return 1;
  return Math.min(8, Math.max(1, Math.round(rawVel / 16)));
}

/** Biome banks: three pitches x eight dynamics addresses every profile.
 *  Bank C has room to grow as new profiles are added. */
export const BIOME_BANKS = Object.freeze({
  75: Object.freeze(['TWILIGHT', 'EMBER', 'ARCTIC', 'JADE', 'VOID', 'SAKURA', 'SOLAR', 'STORM']),
  76: Object.freeze(['MIRROR', 'CYBER', 'ABYSS', 'DUNE', 'CORAL', 'LUMEN', 'AURUM', 'NEBULA']),
  77: Object.freeze(['GEODE']),
});

/** Section transition style by dynamic: soft marks fade, middle marks cut,
 *  the loudest slam the shutter. Mirrors Dramaturgy.classifyTransition's own
 *  three-way vocabulary so a cued boundary is indistinguishable in kind from
 *  a detected one. */
export function transitionForBucket(bucket) {
  if (bucket >= 7) return 'shutter';
  if (bucket >= 4) return 'cut';
  return 'fade';
}

/** WeatherDirector.KINDS in dynamic order; bucket 8 repeats 'wind' so the
 *  loudest mark is never silently ignored. */
export const WEATHER_BY_BUCKET = Object.freeze([
  'rain', 'snow', 'petals', 'embers', 'sunshine', 'fog', 'wind', 'wind',
]);

const BIOME_NAMES = new Set(BIOMES.map((b) => b.name));

/** Resolves a cue's parameter from its pitch + dynamic. Returns null when
 *  the cue takes no parameter (the cue still fires -- a bare crash is a
 *  perfectly good "section starts here"). */
export function cueValue(kind, pitch, bucket) {
  switch (kind) {
    case CueKind.SECTION:
      return transitionForBucket(bucket);
    case CueKind.BIOME: {
      const bank = BIOME_BANKS[pitch];
      const name = bank ? bank[bucket - 1] : null;
      // An out-of-range dynamic (bank C at fff) addresses no profile; the
      // cue is dropped rather than silently snapping to a wrong biome.
      return name && BIOME_NAMES.has(name) ? name : null;
    }
    case CueKind.WEATHER:
      return WEATHER_BY_BUCKET[bucket - 1] || 'rain';
    // Continuous cues: the dynamic IS the strength, 0.125..1.
    case CueKind.METEORS:
    case CueKind.LIGHTNING:
    case CueKind.SHAKE:
    case CueKind.GROUND_PULSE:
    case CueKind.FEVER:
    case CueKind.DROP:
      return bucket / 8;
    default:
      return null;
  }
}

/**
 * Turns one conductor track's raw paired notes into cues.
 * @param {{pitch:number, startMs:number, durMs:number, vel:number}[]} notes
 *   `vel` must be the RAW 0-127 velocity (see velocityBucket).
 * @returns {{tMs:number, kind:string, bucket:number, value:*, durMs:number,
 *            pitch:number}[]} sorted by tMs; unmapped pitches are dropped.
 */
export function cuesFromNotes(notes) {
  const cues = [];
  for (const n of notes || []) {
    const kind = CUE_BY_PITCH[n.pitch];
    if (!kind) continue; // an unmapped drum is a comment, not an error
    const bucket = velocityBucket(n.vel);
    const value = cueValue(kind, n.pitch, bucket);
    // A parameterized cue that resolved to nothing (an unaddressed biome
    // slot) would be a silent no-op downstream -- drop it here instead.
    if (kind === CueKind.BIOME && value === null) continue;
    cues.push({
      tMs: n.startMs, kind, bucket, value,
      durMs: Math.max(0, n.durMs || 0), pitch: n.pitch,
    });
  }
  cues.sort((a, b) => a.tMs - b.tMs);
  return cues;
}

/** Splits a cue list into the two consumption paths. */
export function splitCues(cues) {
  const schedule = [];
  const live = [];
  for (const c of cues || []) (SCHEDULE_KINDS.has(c.kind) ? schedule : live).push(c);
  return { schedule, live };
}

function nearestBarMs(barGrid, tMs) {
  if (!barGrid || barGrid.length === 0) return tMs;
  let best = barGrid[0].ms, bestDist = Math.abs(tMs - best);
  for (let i = 1; i < barGrid.length; i++) {
    const d = Math.abs(tMs - barGrid[i].ms);
    if (d < bestDist) { bestDist = d; best = barGrid[i].ms; }
  }
  return best;
}

const MIN_SECTION_MS = 700; // below this a "section" is a flicker, not a place

/**
 * Folds the schedule cues onto a section plan. SECTION cues cut a new
 * boundary (snapped to the bar grid, since a section that starts off-grid
 * reads as a mistake); BIOME cues override the profile of whichever section
 * contains them. Authored cues WIN over the detected plan -- that is the
 * whole point of a conductor track.
 *
 * `sections` is never mutated; an empty/absent cue list returns the exact
 * same array reference so callers can apply this unconditionally.
 */
export function applyConductorSchedule(sections, cues, barGrid, durationMs) {
  if (!cues || cues.length === 0) return sections;
  if (!sections || sections.length === 0) return sections;

  const sectionCues = cues.filter((c) => c.kind === CueKind.SECTION);
  const biomeCues = cues.filter((c) => c.kind === CueKind.BIOME);

  let out = sections.map((s) => ({ ...s }));

  if (sectionCues.length) {
    // Every authored boundary, snapped and de-duplicated, plus the song's
    // own start/end. Boundaries closer together than MIN_SECTION_MS collapse
    // into the earlier one rather than producing unreadable slivers.
    const bounds = [0];
    for (const c of sectionCues) {
      const snapped = Math.max(0, Math.min(durationMs, nearestBarMs(barGrid, c.tMs)));
      if (snapped - bounds[bounds.length - 1] >= MIN_SECTION_MS) bounds.push(snapped);
    }
    if (durationMs - bounds[bounds.length - 1] < MIN_SECTION_MS && bounds.length > 1) bounds.pop();
    bounds.push(durationMs);

    // Each new section inherits the detected plan's read of that moment
    // (profile, label, hue bias, lyric fields) so cueing a boundary never
    // costs the analysis everything else already knew about the music there.
    const rebuilt = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const startMs = bounds[i];
      const endMs = bounds[i + 1];
      const inherited = sectionContaining(out, startMs) || out[0];
      const cue = sectionCues.find(
        (c) => Math.abs(nearestBarMs(barGrid, c.tMs) - startMs) < 1,
      );
      rebuilt.push({
        ...inherited,
        startMs,
        endMs,
        // The first section has nothing to transition FROM; leave the
        // inherited style there so an opening cue can't shutter into frame.
        transition: i > 0 && cue ? cue.value : inherited.transition,
        cued: !!cue,
      });
    }
    out = rebuilt;
  }

  for (const c of biomeCues) {
    const sec = sectionContaining(out, c.tMs);
    if (sec) { sec.profile = c.value; sec.cuedBiome = true; }
  }

  return out;
}

function sectionContaining(sections, tMs) {
  for (const s of sections) if (tMs >= s.startMs && tMs < s.endMs) return s;
  return tMs >= (sections[sections.length - 1]?.endMs ?? 0)
    ? sections[sections.length - 1]
    : sections[0];
}
