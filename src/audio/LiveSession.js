// Turning "the room is playing something" into a show.
//
// The offline path hands `startTimeline` a finished object: a note timeline,
// a bar grid, energy curves, a duration, sections. Listening has none of
// that at the moment the listener taps the button -- the song has not
// happened yet.
//
// So this builds the same shape out of nothing and then keeps filling it in.
// The world starts on the first frames it hears and gets more specific as
// the song reveals itself: the tempo locks after a few seconds, the bar grid
// densifies as bars actually elapse, and sections are appended when the
// analyser notices one has arrived rather than being known in advance.
//
// Two design consequences worth stating, because they are the honest cost of
// listening rather than reading, and pretending otherwise would produce a
// show that lies about what it knows:
//
//   NO ARC. The offline path knows where the climax is because it has seen
//   the whole song. This one cannot. Anything that reads `progress` gets a
//   value derived from elapsed time against a nominal length, which is a
//   guess, and it is flagged as one (`estimatedDuration: true`) so the
//   dramaturgy can choose not to spend a finale on it.
//
//   SECTIONS ARE LATE. A boundary can only be recognised once the new
//   material has played. That is roughly a bar of lag, by construction.
//
// No DOM and no Web Audio here: LiveInput owns the microphone, LiveAnalyser
// owns the DSP, and this owns the bookkeeping that makes the two look like a
// song to everything downstream.
import { LiveAnalyser } from './LiveAnalyser.js';

/** What we assume a song is worth, before we know better. Only used for the
 *  progress fraction; nothing schedules against it. */
export const NOMINAL_SONG_MS = 210000;
/** Bars are generated this far ahead of the clock so anything reading the
 *  grid always finds a next bar. */
const BAR_LOOKAHEAD_MS = 8000;
const DEFAULT_BPM = 120;

/**
 * A rolling, self-extending stand-in for a timeline.
 *
 * `startData()` gives the caller something `startTimeline` can accept before
 * a single note has been heard; `tick()` then keeps it current.
 */
export class LiveSession {
  constructor({ sampleRate = 48000, fftSize = 2048, nominalMs = NOMINAL_SONG_MS } = {}) {
    this.analyser = new LiveAnalyser({ sampleRate, fftSize });
    this.nominalMs = nominalMs;
    this.startedMs = null;
    this.bpm = DEFAULT_BPM;
    this.barGrid = [];
    this.sections = [];
    this.energy01 = 0;
    this.onset = 0;
    this.bands = new Array(7).fill(0);
    this._nextBarMs = 0;
    this._barIdx = 0;
  }

  /**
   * The object handed to startTimeline at tap time.
   *
   * Deliberately EMPTY of notes. The show is driven by what is heard, so a
   * synthesised note timeline would be a second, wrong source of truth
   * competing with the microphone.
   */
  startData() {
    return {
      timeline: [],
      barGrid: [],
      durationMs: this.nominalMs,
      bpm: DEFAULT_BPM,
      // Everything downstream keys off this to know it is not looking at a
      // finished analysis. A guessed duration must never be mistaken for a
      // measured one -- that is what would let the finale fire at a moment
      // chosen from a number nobody measured.
      live: true,
      estimatedDuration: true,
    };
  }

  /**
   * Feed one frame of FFT magnitudes.
   *
   * @returns {{sectionJustChanged:boolean, bpm:number, energy01:number}}
   */
  tick(magnitudes, nowMs) {
    if (this.startedMs == null) {
      this.startedMs = nowMs;
      this._nextBarMs = nowMs;
    }
    const changed = this.analyser.push(magnitudes, nowMs);
    this.energy01 = this.analyser.energy01;
    this.onset = this.analyser.onset;
    this.bands = this.analyser.bands;
    if (this.analyser.bpm > 0) this.bpm = this.analyser.bpm;

    this._extendBars(nowMs);
    if (changed) {
      // Close the previous section and open a new one. The boundary time is
      // when it was NOTICED, which is a beat or so after it began -- see the
      // module header. Recording the noticed time rather than back-dating a
      // guess keeps the schedule honest about its own latency.
      const prev = this.sections[this.sections.length - 1];
      if (prev) prev.endMs = nowMs;
      this.sections.push({ startMs: nowMs, endMs: nowMs + 1 });
    } else if (this.sections.length === 0) {
      this.sections.push({ startMs: this.startedMs, endMs: nowMs + 1 });
    } else {
      this.sections[this.sections.length - 1].endMs = nowMs + 1;
    }
    return { sectionJustChanged: changed, bpm: this.bpm, energy01: this.energy01 };
  }

  /** Keep the bar grid populated a little ahead of the clock. */
  _extendBars(nowMs) {
    const barMs = (60000 / Math.max(1, this.bpm)) * 4;
    let guard = 0;
    while (this._nextBarMs <= nowMs + BAR_LOOKAHEAD_MS && guard++ < 64) {
      this.barGrid.push({ ms: this._nextBarMs, index: this._barIdx++ });
      this._nextBarMs += barMs;
    }
    // The grid only ever grows, so trim what has scrolled well past. Nothing
    // reads more than a few bars back, and an unbounded array on a long
    // listening session is a slow leak.
    if (this.barGrid.length > 512) this.barGrid.splice(0, this.barGrid.length - 512);
  }

  /**
   * Progress through a song whose length nobody knows.
   *
   * A guess, and labelled as one. It saturates rather than exceeding 1 so a
   * long listen does not drive anything past its own end.
   */
  progress01(nowMs) {
    if (this.startedMs == null) return 0;
    return Math.max(0, Math.min(1, (nowMs - this.startedMs) / Math.max(1, this.nominalMs)));
  }

  /** Elapsed listening time, for the silence check. */
  elapsedMs(nowMs) {
    return this.startedMs == null ? 0 : nowMs - this.startedMs;
  }
}
