// What a performance carries from one moment to the next, and how it
// survives a rebuild.
//
// A song is rebuilt three ways while it plays: a seek, a replay, and the
// whole-song analysis arriving for a song that started on its opening
// (adoptFullAnalysisLive). Each builds a new Simulation. Its musical
// directors used to start from their defaults -- calm at full, the vibe
// neutral, the weather clear, the key unknown -- so every rebuild showed a
// jump that nothing in the music made.
//
// Channel inventory (Task 11):
//
//   continuous, carried here      calm level and cue floor; hype envelopes
//                                 (fast, slow, surge, build-up) and drop
//                                 cooldown; vibe valence/epic and the held
//                                 key; key-director rotation and its
//                                 modulation state; weather kind, intensity,
//                                 severity and ground reservoirs; the
//                                 opening director's hold and gain; the
//                                 lyric-form easing that biases epic
//   continuous, owned elsewhere   chapter / camera (chapterState and
//                                 keepUserCamera on the rebuild); accepted
//                                 geography (the song's terrain on its data);
//                                 land and ridge history (RidgeMotionHistory
//                                 handoff); the storm envelope (RangeStorm
//                                 handoff, below)
//   one-shot, never replayed      key-change waves and mandala reseeds, drop
//                                 rings, lightning, cue flashes and shakes,
//                                 lyric glyphs, particles, kick slams
//
// Two operations:
//   capture/restore  the whole-song analysis arriving mid-song: the state on
//                    screen is carried across exactly, and the directors then
//                    ease toward the new analysis at their own rates.
//   reconstruct      a seek or replay: the continuous readers are run from the
//                    song's start to the destination on the fixed simulation
//                    step, with the same ordered updates and inputs as
//                    playback, and no one-shot is emitted on the way.
import { visualNow, MAX_LATENCY_MS } from '../core/ChoreoClock.js';

/** Playback's fixed simulation step (main.js STEP_MS). */
export const RECONSTRUCT_STEP_MS = 1000 / 120;

export const CONTINUOUS_CHANNELS = Object.freeze(['calm', 'hype', 'vibe', 'keyDirector', 'weather', 'opening']);

// Fields that are not carried: per-frame one-shots, and cursors into the old
// performance's note arrays (a rebuilt director scans its own from the start).
const SKIP = Object.freeze({
  hype: new Set(['slam']),
  vibe: new Set(['_lo', '_hi']),
  keyDirector: new Set(['justKeyChange', 'transitionActive', 'transitionProgress', '_waveStartMs']),
});


// BiomeManager's eased lyric form (easeLyricForm), read by the vibe's epic bias.
const FORM_FIELDS = Object.freeze(['lyricIntensityEased', 'kindConfidenceEased', '_kindBudgetMulEased']);

function isPlain(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function snapshotOf(obj, skip = null) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip?.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || v === null) out[k] = v;
    else if (isPlain(v)) out[k] = structuredClone(v);
  }
  return out;
}

/** The continuous state of a running performance. */
export function captureContinuous(sim) {
  const state = { channels: {}, form: null };
  for (const name of CONTINUOUS_CHANNELS) {
    if (sim?.[name]) state.channels[name] = snapshotOf(sim[name], SKIP[name]);
  }
  const b = sim?.biomes;
  if (b) {
    state.form = { currentKind: b.currentKind ?? null };
    for (const k of FORM_FIELDS) state.form[k] = b[k];
  }
  return state;
}

/** Carry a captured state onto a newly built performance. */
export function restoreContinuous(sim, state) {
  if (!sim || !state?.channels) return false;
  for (const [name, fields] of Object.entries(state.channels)) {
    const target = sim[name];
    if (!target) continue;
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in target)) continue;
      target[k] = isPlain(v) ? structuredClone(v) : v;
    }
  }
  if (state.form && sim.biomes) {
    for (const k of FORM_FIELDS) if (Number.isFinite(state.form[k])) sim.biomes[k] = state.form[k];
    if (typeof state.form.currentKind === 'string' || state.form.currentKind === null) sim.biomes.currentKind = state.form.currentKind;
  }
  // A drop already on screen keeps its ring, but BiomeManager edge-detects
  // dropAtMs to launch the drop's lake ring, meteors and tsunami wall: the
  // new manager has to know it already saw this one.
  if (sim.biomes && sim.hype) sim.biomes._lastSeenDropAtMs = sim.hype.dropAtMs;
  return true;
}

/**
 * Run the continuous readers of `sim` (freshly built) from the song's start
 * to source time `toMs` on a fixed `stepMs`, through the same methods
 * playback uses (Simulation._applyCue, _advanceMusic, OpeningDirector.update,
 * BiomeManager.easeLyricForm) in Simulation.step's order, on heard time from
 * the same latency clamp. Live cues that change continuous state are applied;
 * their visual one-shots are not. Returns the number of steps taken.
 */
export function reconstructContinuous(sim, toMs, { stepMs = RECONSTRUCT_STEP_MS } = {}) {
  if (!sim || !(toMs > 0) || !(stepMs > 0)) return 0;
  const lag = sim._outputLatencyFn ? Math.min(MAX_LATENCY_MS, Math.max(0, sim._outputLatencyFn() || 0)) : 0;
  const cues = sim.cues?.cues || [];
  const curves = sim.energyCurves;
  const biomes = sim.biomes;
  let cue = 0;
  let steps = 0;
  // Playback steps t = stepMs, 2*stepMs, ...; the remainder up to toMs is
  // one short step, so the state lands on the destination itself.
  for (let t = 0; t < toMs - 1e-6;) {
    const next = Math.min(toMs, t + stepMs);
    const dtSec = (next - t) / 1000;
    t = next;
    const heard = Math.max(0, visualNow(t, lag));
    while (cue < cues.length && cues[cue].tMs <= heard) sim._applyCue(cues[cue++], heard, { oneShots: false });
    sim._advanceMusic(heard, dtSec);
    sim.opening.update(heard, dtSec, curves);
    if (biomes) biomes.easeLyricForm(biomes.sections?.[biomes._sectionAt(visualNow(t, lag))], dtSec);
    steps++;
  }
  // Nothing that happened on the way is announced at the destination: no
  // key-change wave, no drop ring or slam, no pending modulation.
  const key = sim.keyDirector;
  key.justKeyChange = false;
  key.transitionActive = false;
  key.transitionProgress = 0;
  key._pendingChange = null;
  key._pendingWaveAtMs = null;
  sim.hype.slam = 0;
  sim.hype.dropAtMs = -Infinity;
  return steps;
}
