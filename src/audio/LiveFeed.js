// A beat grid the show can see coming, built from a signal that only ever
// arrives late.
//
// Everything choreographed in this engine lands ON the beat because it knows
// the beat in advance: `Conductor.subscribeAhead` hands a note to a listener
// `leadMs` BEFORE its time so a jump can start early and peak exactly on it.
// A microphone cannot deliver that -- an onset is, by definition, evidence
// that something has already happened. Feeding detected onsets straight into
// the timeline would put every jump a reaction-time behind the music, which
// is precisely the failure the anticipation channel exists to prevent.
//
// So this does not forward what it heard. It maintains a PHASE-LOCKED beat
// clock -- period from the analyser's tempo estimate, phase corrected by the
// onsets -- and emits notes on the grid a beat or two into the FUTURE. The
// onsets are evidence about where the grid is, not events in their own
// right. When the estimate is good the emitted grid and the real music are
// the same thing, and the show anticipates a beat that has not played yet.
//
// What is honest about the seam, stated rather than hidden:
//
//   The grid is a PREDICTION. When the tempo estimate is poor, the show
//   dances to a beat the song is not playing. `confidence` is published so
//   anything that would rather do nothing than do the wrong thing can tell.
//
//   Emitted notes are not transcription. Pitch comes from where the spectral
//   mass currently sits, not from pitch detection; it is a plausible line in
//   a plausible key, moving with the music, and no more than that. The
//   timeline synth is muted in live mode, so nothing is ever heard -- these
//   notes only drive choreography.
import { makeNoteEvent, Role, GM_DRUM } from '../core/NoteEvent.js';
import { clamp01 } from '../utils/math.js';

/** How far ahead of the clock notes are emitted. Long enough to clear the
 *  deepest anticipation lead in the engine, short enough that a phase
 *  correction can still land before the notes it would have moved. */
export const EMIT_HORIZON_MS = 900;
/** An onset closer than this fraction of a beat to the predicted beat is
 *  treated as evidence about phase; anything further is a syncopation and
 *  must not drag the grid onto the offbeat. */
export const PHASE_CAPTURE = 0.3;
/** How hard one onset pulls the grid. Small: the grid should be steadied by
 *  many onsets, not yanked by one. */
export const PHASE_PULL = 0.14;
/** Minor pentatonic, so any two emitted notes agree with each other whatever
 *  the spectrum does. */
const SCALE = [0, 3, 5, 7, 10];
const BASS_ROOT = 36;
const MELODY_ROOT = 60;

/**
 * The live note source.
 *
 * `emit(nowMs, state)` returns the NoteEvents that should be appended to the
 * conductor's timeline this frame -- possibly none. Nothing here mutates the
 * conductor itself; the caller owns that, so this stays testable in node.
 */
export class LiveFeed {
  constructor({ horizonMs = EMIT_HORIZON_MS } = {}) {
    this.horizonMs = horizonMs;
    this.bpm = 120;
    this.confidence = 0;
    /** Time of the next beat to be emitted. Null until the first emit. */
    this.nextBeatMs = null;
    this.beatIndex = 0;
    this._emittedTo = 0;
    this._degree = 0;
    this._octave = 0;
  }

  get beatMs() { return 60000 / Math.max(1, this.bpm); }

  /**
   * Correct the grid's phase from a detected onset.
   *
   * Only onsets near a predicted beat count -- see PHASE_CAPTURE. Pulling on
   * every onset would lock the grid to whatever subdivision the song happens
   * to be busiest on, which on most produced music is the hi-hat.
   */
  pushOnset(tMs, strength = 1) {
    if (this.nextBeatMs == null || !(strength > 0)) return false;
    const period = this.beatMs;
    // Signed distance to the nearest beat on the grid, which may be behind
    // `nextBeatMs` -- the onset we are reacting to has already happened.
    const k = Math.round((tMs - this.nextBeatMs) / period);
    const nearest = this.nextBeatMs + k * period;
    const err = tMs - nearest;
    if (Math.abs(err) > period * PHASE_CAPTURE) return false;
    const pull = PHASE_PULL * clamp01(strength);
    this.nextBeatMs += err * pull;
    return true;
  }

  /**
   * The notes due between the last call and `nowMs + horizon`.
   *
   * @param {number} nowMs
   * @param {object} state
   * @param {number} state.bpm     analyser tempo estimate (0 = not yet)
   * @param {number} state.confidence 0..1
   * @param {number[]} state.bands seven band energies
   * @param {number} state.energy01
   * @returns {import('../core/NoteEvent.js').NoteEvent[]}
   */
  emit(nowMs, { bpm = 0, confidence = 0, bands = null, energy01 = 0 } = {}) {
    if (bpm > 0) this.bpm = bpm;
    this.confidence = clamp01(confidence);
    if (this.nextBeatMs == null) this.nextBeatMs = nowMs + this.beatMs;

    // A stall (backgrounded tab, a breakpoint) left the grid in the past.
    // Jump it forward to now BEFORE emitting: catching up afterwards would
    // still have emitted a backlog of notes whose times have already passed,
    // which is the one thing this module exists to avoid.
    if (this.nextBeatMs < nowMs) {
      const skipped = Math.ceil((nowMs - this.nextBeatMs) / this.beatMs);
      this.nextBeatMs += skipped * this.beatMs;
      this.beatIndex += skipped;
    }

    const out = [];
    const horizon = nowMs + this.horizonMs;
    let guard = 0;
    while (this.nextBeatMs <= horizon && guard++ < 32) {
      const t = this.nextBeatMs;
      if (t > this._emittedTo) {
        this._emitBeat(out, t, this.beatIndex % 4, bands, energy01);
        this._emittedTo = t;
      }
      this.beatIndex++;
      this.nextBeatMs += this.beatMs;
    }
    return out;
  }

  /** One beat's worth of notes. */
  _emitBeat(out, tMs, inBar, bands, energy01) {
    const b = bands || [0, 0, 0, 0, 0, 0, 0];
    const low = Math.max(b[0], b[1]);
    const mid = Math.max(b[2], b[3]);
    const high = Math.max(b[4], b[5], b[6]);
    const e = clamp01(energy01);
    const downbeat = inBar === 0;
    const backbeat = inBar === 1 || inBar === 3;

    // --- the pulse ---------------------------------------------------------
    // `kick: true` is what may drive a Midio jump, so it goes on the beats a
    // person would actually jump on -- 1 and 3 -- rather than on every
    // detected transient, which would make him twitch continuously.
    if (!backbeat) {
      out.push(makeNoteEvent({
        tMs, durMs: 120, pitch: GM_DRUM.KICK, vel: clamp01(0.45 + low * 0.55),
        role: Role.RHYTHM, kick: true, src: 'audio', channel: 1,
      }));
    } else {
      out.push(makeNoteEvent({
        tMs, durMs: 100, pitch: GM_DRUM.SNARE, vel: clamp01(0.35 + mid * 0.5),
        role: Role.RHYTHM, kick: false, src: 'audio', channel: 3,
      }));
    }
    // Hats track the top end, and only appear once there is a top end to
    // track -- a bass-heavy passage should not sound busy up there.
    if (high > 0.12) {
      out.push(makeNoteEvent({
        tMs, durMs: 60, pitch: GM_DRUM.HAT, vel: clamp01(0.2 + high * 0.5),
        role: Role.RHYTHM, kick: false, src: 'audio', channel: 5, pan: 0.15,
      }));
    }

    // --- the line ----------------------------------------------------------
    // Where the spectral mass sits decides the scale degree. It moves with
    // the music without pretending to be pitch detection.
    const centroid = this._centroid(b);
    this._degree = Math.round(centroid * (SCALE.length - 1));
    this._octave = centroid > 0.66 ? 1 : 0;
    const deg = SCALE[Math.max(0, Math.min(SCALE.length - 1, this._degree))];

    if (downbeat || inBar === 2) {
      out.push(makeNoteEvent({
        tMs, durMs: this.beatMs * 0.9, pitch: BASS_ROOT + (downbeat ? 0 : deg),
        vel: clamp01(0.4 + low * 0.5), role: Role.BASS, kick: false,
        src: 'audio', channel: 0, lane: 'BROSHI',
      }));
    }
    if (mid > 0.15 || high > 0.2) {
      out.push(makeNoteEvent({
        tMs, durMs: this.beatMs * 0.7, pitch: MELODY_ROOT + deg + this._octave * 12,
        vel: clamp01(0.3 + mid * 0.6), role: Role.MELODY, kick: false,
        src: 'audio', channel: 2, lane: 'MIDIO',
      }));
    }
    // Pads only under sustained energy, so a quiet passage stays thin.
    if (e > 0.4) {
      out.push(makeNoteEvent({
        tMs, durMs: this.beatMs * 3.5, pitch: MELODY_ROOT - 12 + deg,
        vel: clamp01(0.15 + e * 0.3), role: Role.PAD, kick: false,
        src: 'audio', channel: 4,
      }));
    }

    // --- the offbeat -------------------------------------------------------
    // Last, because it is the only note in this beat that does not land ON
    // the beat, and the caller appends straight onto the conductor's
    // timeline -- which walks a cursor forward and expects time order.
    // An eighth-note offbeat only when the music is actually busy, so the
    // subdivision follows the song's density rather than being constant.
    if (high > 0.12 && e > 0.55) {
      out.push(makeNoteEvent({
        tMs: tMs + this.beatMs / 2, durMs: 50, pitch: GM_DRUM.HAT,
        vel: clamp01(0.12 + high * 0.3), role: Role.RHYTHM, kick: false,
        src: 'audio', channel: 5, pan: -0.15,
      }));
    }
  }

  /** Normalized 0..1 position of the spectral mass across the seven bands. */
  _centroid(bands) {
    let num = 0, den = 0;
    for (let i = 0; i < bands.length; i++) { num += i * bands[i]; den += bands[i]; }
    return den > 1e-9 ? clamp01(num / den / Math.max(1, bands.length - 1)) : 0.3;
  }
}
