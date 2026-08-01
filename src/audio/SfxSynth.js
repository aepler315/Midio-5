// Judgment feedback sounds: consonant when the press was timed right, sour
// when it wasn't. Envelope shapes follow SimpleSynth's voices; everything
// routes through a dedicated sfx gain into the engine master so feedback
// level is independent of the music. Pitches key to the song's current
// tonic (VibeDirector) so a perfect hit always rings *in key* — the reward
// literally harmonizes with the track.
const SFX_GAIN = 0.6;
const ROOT_MIDI = 72; // C5 register: bright, above the music's mid band
const TONIC_CONF_MIN = 0.2; // below this the tonic is a guess — fall back to C
const PENTA = [0, 2, 4, 7, 9]; // hold ticks climb a major pentatonic

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class SfxSynth {
  constructor(audioEngine) {
    this.ae = audioEngine;
    this.out = audioEngine.ctx.createGain();
    this.out.gain.value = SFX_GAIN;
    this.out.connect(audioEngine.master);
  }

  _root(tonicPc, confidence) {
    const pc = confidence >= TONIC_CONF_MIN ? ((tonicPc % 12) + 12) % 12 : 0;
    return ROOT_MIDI + pc;
  }

  _pluck(midi, t, { peak = 0.2, dur = 0.16, type = 'sine', bendTo = null, bendSec = 0.12 } = {}) {
    const ctx = this.ae.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    if (bendTo !== null) osc.frequency.exponentialRampToValueAtTime(midiToFreq(bendTo), t + bendSec);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _scuff(t, { vel = 0.4, hpFreq = 1800, dur = 0.08 } = {}) {
    const ctx = this.ae.ctx;
    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = hpFreq;
    const gain = ctx.createGain();
    gain.gain.value = vel;
    src.connect(hp).connect(gain);
    gain.connect(this.out);
    src.start(t);
  }

  judgment(tier, tonicPc = 0, confidence = 0) {
    const t = this.ae.ctx.currentTime;
    const root = this._root(tonicPc, confidence);
    switch (tier) {
      case 'perfect': // root + fifth + an octave sparkle: the full chime
        this._pluck(root, t, { peak: 0.22, dur: 0.18 });
        this._pluck(root + 7, t + 0.03, { peak: 0.18, dur: 0.18 });
        this._pluck(root + 12, t + 0.06, { peak: 0.14, dur: 0.22, type: 'triangle' });
        break;
      case 'great':
        this._pluck(root, t, { peak: 0.18, dur: 0.15 });
        this._pluck(root + 7, t + 0.03, { peak: 0.12, dur: 0.15 });
        break;
      case 'good':
        this._pluck(root, t, { peak: 0.13, dur: 0.12, type: 'triangle' });
        break;
      case 'sour':
      default: // a semitone rub sagging downward over a gritty scuff
        this._pluck(root - 12, t, { peak: 0.16, dur: 0.22, type: 'sawtooth', bendTo: root - 15, bendSec: 0.18 });
        this._pluck(root - 11, t, { peak: 0.14, dur: 0.2, type: 'sawtooth', bendTo: root - 14, bendSec: 0.18 });
        this._scuff(t, { vel: 0.4, hpFreq: 1800, dur: 0.08 });
        break;
    }
  }

  /** A note slid past untapped: the quietest cue in the set — presence, not punishment. */
  miss() {
    this._pluck(41, this.ae.ctx.currentTime, { peak: 0.09, dur: 0.15, bendTo: 31, bendSec: 0.1 });
  }

  /** Each paid tick climbs the pentatonic, lifting an octave on the wrap. */
  holdTick(i = 0, tonicPc = 0, confidence = 0) {
    const root = this._root(tonicPc, confidence);
    const step = PENTA[i % PENTA.length] + 12 * Math.min(1, Math.floor(i / PENTA.length));
    this._pluck(root + step, this.ae.ctx.currentTime, { peak: 0.09, dur: 0.09 });
  }

  holdComplete(tonicPc = 0, confidence = 0) {
    const t = this.ae.ctx.currentTime;
    const root = this._root(tonicPc, confidence);
    [0, 7, 12].forEach((s, i) => {
      this._pluck(root + s, t + i * 0.04, { peak: 0.18, dur: 0.35, type: 'triangle' });
    });
  }

  /** Early release: the riser chokes — a damped downward smear, unmistakably "dropped". */
  holdChoke() {
    const t = this.ae.ctx.currentTime;
    this._pluck(60, t, { peak: 0.15, dur: 0.2, type: 'sawtooth', bendTo: 48, bendSec: 0.16 });
    this._scuff(t, { vel: 0.35, hpFreq: 900, dur: 0.1 });
  }

  /** The Lens crossing into (or back out of) an interior: a soft filtered-
   *  noise swell with a swept bandpass, quiet enough to read as air moving
   *  rather than a sound effect. `direction` 1 = sweeping up into the world
   *  (zooming in), -1 = sweeping back down (zooming out). */
  transit(direction = 1) {
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    const dur = 0.5;
    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    const [f0, f1] = direction >= 0 ? [500, 2400] : [2400, 500];
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp).connect(gain).connect(this.out);
    src.start(t);
  }
}
