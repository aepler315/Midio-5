// The tap-recalibration overlay.
//
// BeatAnchor has always been able to take a tapped-in tempo and phase and
// steer the whole show with it -- but the only feedback it ever gave was a
// neutral splat, so nothing told the player the feature existed, what to tap,
// or how long to keep tapping. This is that missing half: a big block count
// through eight measures, one line of instruction, and a live view of the
// anchor's confidence so the tapping visibly lands.
//
// Two deliberate properties:
//   * It never interrupts. The song plays on, the world keeps moving, the
//     panel is pointer-events:none, and taps fall straight through to the
//     canvas handler that already feeds BeatAnchor. Nothing here handles
//     input -- it only draws.
//   * The instruction is about GROOVE, not subdivision. Tapping straight
//     time tells the anchor almost nothing it didn't already have; tapping
//     what you'd slap the table to lands on the kick/snare pattern, which is
//     where the downbeat actually lives.
//
// It reads the clock the caller hands it, so it stays in step with whatever
// the sim considers "now" -- including output-latency compensation.

export const RECAL_MEASURES = 8;
const BEATS_PER_MEASURE = 4;
// Fade the instruction once the player has clearly read it; the count is the
// useful part after that.
const INSTRUCTION_MEASURES = 2;

export class RecalibrationOverlay {
  /**
   * @param {object} els {panel, number, instruction, pips, confFill, status}
   */
  constructor(els = {}) {
    this.els = els;
    this.active = false;
    this.startMs = 0;
    this.beatPeriodMs = 500;
    this._lastBeat = -1;
    this._startConfidence = 0;
    this._raf = 0;
    this._buildPips();
  }

  _buildPips() {
    const { pips } = this.els;
    if (!pips || pips.childElementCount) return;
    for (let i = 0; i < BEATS_PER_MEASURE; i++) pips.appendChild(document.createElement('span'));
  }

  /**
   * @param {number} nowMs        the sim clock the count should run on
   * @param {number} beatPeriodMs current beat length (JumpController's EMA)
   * @param {number} confidence   BeatAnchor.confidence at entry, for the delta
   */
  start(nowMs, beatPeriodMs, confidence = 0) {
    if (this.active) return;
    this.active = true;
    this.startMs = nowMs;
    this.beatPeriodMs = Math.max(1, beatPeriodMs || 500);
    this._lastBeat = -1;
    this._startConfidence = confidence;
    const { panel, instruction, status } = this.els;
    instruction?.classList.remove('faded');
    if (status) status.textContent = '';
    panel?.classList.remove('hidden');
    panel?.setAttribute('aria-hidden', 'false');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const { panel } = this.els;
    panel?.classList.add('hidden');
    panel?.setAttribute('aria-hidden', 'true');
  }

  /** Total length of a full pass, so callers can reason about it without
   *  duplicating the arithmetic. */
  durationMs(beatPeriodMs = this.beatPeriodMs) {
    return RECAL_MEASURES * BEATS_PER_MEASURE * Math.max(1, beatPeriodMs);
  }

  /**
   * Draw one frame. Call every sim step while active.
   * @returns {boolean} false once the eight measures are done (the caller
   *   should stop() and, if it likes, report the confidence delta).
   */
  update(nowMs, { beatPeriodMs = null, confidence = 0 } = {}) {
    if (!this.active) return false;
    // Track live tempo so a drifting/retuning estimate doesn't desynchronize
    // the count from what's actually playing.
    if (beatPeriodMs > 0) this.beatPeriodMs = beatPeriodMs;

    const elapsed = nowMs - this.startMs;
    const beat = Math.floor(elapsed / this.beatPeriodMs);
    const totalBeats = RECAL_MEASURES * BEATS_PER_MEASURE;
    if (beat >= totalBeats) return false;

    const measure = Math.floor(beat / BEATS_PER_MEASURE) + 1;
    const beatInMeasure = ((beat % BEATS_PER_MEASURE) + BEATS_PER_MEASURE) % BEATS_PER_MEASURE;
    const phase = Math.max(0, Math.min(1, (elapsed % this.beatPeriodMs) / this.beatPeriodMs));

    const { number, instruction, pips, confFill, status } = this.els;

    if (number) {
      if (measure !== this._lastMeasure) {
        number.textContent = String(measure);
        this._lastMeasure = measure;
      }
      // Swell into the beat and snap on it -- the same shape the old
      // calibration beacon used, so the count is readable as a pulse even
      // with the sound off.
      const swell = 1 + 0.10 * (1 - phase) ** 3;
      number.style.transform = `scale(${swell.toFixed(3)})`;
      number.style.opacity = (0.55 + 0.45 * (1 - phase) ** 2).toFixed(3);
    }

    if (pips && beat !== this._lastBeat) {
      for (let i = 0; i < pips.childElementCount; i++) {
        pips.children[i].classList.toggle('on', i === beatInMeasure);
      }
      this._lastBeat = beat;
    }

    if (instruction && measure > INSTRUCTION_MEASURES) instruction.classList.add('faded');
    if (confFill) confFill.style.width = `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
    if (status) {
      status.textContent = confidence >= 0.85
        ? 'Locked on — keep going or stop whenever.'
        : confidence >= 0.4
          ? 'Got it, keep tapping…'
          : `Measure ${measure} of ${RECAL_MEASURES}`;
    }
    return true;
  }

  /** A short human summary of what the pass achieved, for the status line. */
  resultText(confidence) {
    const gained = confidence - this._startConfidence;
    if (confidence >= 0.85) return 'Synced to your groove.';
    if (gained > 0.2) return 'Better — tap again anytime to tighten it.';
    return 'No change kept. Tap along whenever it drifts.';
  }
}
