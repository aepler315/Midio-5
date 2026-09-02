// Getting a live signal into the engine, on a phone, with one tap.
//
// The constraint that decides this whole design: there is no way to read the
// audio a streaming service is playing. Spotify's is DRM'd and its analysis
// API returns 403 to any application registered after November 2024; a
// YouTube embed is a cross-origin iframe, so the Web Audio API cannot reach a
// single sample of it; and `getDisplayMedia` tab-audio capture -- the answer
// on a desktop -- does not exist on mobile at all (iOS Safari has no
// getDisplayMedia, and Android Chrome cannot capture tab audio).
//
// What every phone does have is a microphone, and the speaker is already
// playing the song. So the page listens to the room. That is one permission
// prompt, no account linking, no app switching, and it works with whatever
// the listener is already using -- which is the only version of this that a
// person who just wants to watch something pretty will actually complete.
//
// Two honest caveats, surfaced rather than buried, because they decide
// whether the feature works for a given listener:
//
//   HEADPHONES. If the music is going into headphones the microphone hears
//   the room, not the song. There is no way around this and no way to detect
//   it reliably -- so the UI says so up front rather than leaving someone
//   staring at a still landscape wondering what broke.
//
//   ECHO CANCELLATION. Browsers default to processing microphone input for
//   voice calls: echo cancellation, noise suppression and auto gain will
//   variously subtract, gate and pump the music. All three are explicitly
//   disabled below. This is the single most important line in the file --
//   with them on, the signal that reaches the analyser is actively hostile
//   to beat detection.
//
// This module owns only the getUserMedia/AnalyserNode plumbing. The DSP is
// LiveAnalyser.js, which is pure and tested separately.

/** Constraints that ask for the raw signal rather than a cleaned-up voice. */
export const RAW_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

/** Is live listening even possible here? */
export function liveInputSupported(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  return !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
}

/**
 * Turn a getUserMedia rejection into something worth showing a person.
 *
 * The raw DOMException names are accurate and useless ("NotAllowedError").
 * Each of these maps to a different thing the listener should actually do.
 */
export function describeMicError(err) {
  const name = err && (err.name || err.constructor?.name);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Something else is using the microphone. Close it and try again.';
    case 'OverconstrainedError':
      return 'This microphone can’t provide a usable signal.';
    default:
      return `Couldn’t start listening: ${(err && err.message) || 'unknown error'}`;
  }
}

/**
 * A live microphone feed, exposed as frequency frames.
 *
 * `start()` prompts for permission and begins; `read()` returns the current
 * FFT magnitudes (or null before start); `stop()` releases the device --
 * which matters, because a page holding an open microphone shows a recording
 * indicator and drains battery.
 */
export class LiveInput {
  constructor({ fftSize = 2048, smoothing = 0.55 } = {}) {
    this.fftSize = fftSize;
    // Some smoothing, but far less than the Web Audio default (0.8): heavy
    // smoothing is what makes an onset detector blind, and onsets are the
    // whole tempo estimate.
    this.smoothing = smoothing;
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.sampleRate = 48000;
    this._bins = null;
    this.active = false;
  }

  /**
   * @param {object} [deps] injectable for tests -- nothing here touches a
   *   global directly, so the whole class can run headless.
   */
  async start({
    nav = (typeof navigator !== 'undefined' ? navigator : null),
    AudioCtx = (typeof AudioContext !== 'undefined' ? AudioContext : null),
  } = {}) {
    if (this.active) return true;
    if (!liveInputSupported(nav)) throw new Error('This browser cannot listen to audio.');
    if (!AudioCtx) throw new Error('Web Audio is unavailable in this browser.');

    this.stream = await nav.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS, video: false });
    this.ctx = new AudioCtx();
    // Autoplay policy: a context created inside a user gesture may still
    // start suspended on some browsers.
    if (this.ctx.state === 'suspended' && this.ctx.resume) await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate || 48000;

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = this.smoothing;
    source.connect(this.analyser);
    // Deliberately NOT connected to the destination: routing the microphone
    // to the speakers is a feedback loop, and on a phone that is a howl.
    this._bins = new Float32Array(this.analyser.frequencyBinCount);
    this.active = true;
    return true;
  }

  /** Current FFT magnitudes, or null when not listening. */
  read() {
    if (!this.active || !this.analyser || !this._bins) return null;
    // Float dB data rather than the byte API: the byte version clips at its
    // own floor, and a quiet phone speaker across a room lives near it.
    this.analyser.getFloatFrequencyData(this._bins);
    // dB (typically -140..0) -> linear-ish 0..1. Below the floor is silence.
    const out = this._bins;
    for (let i = 0; i < out.length; i++) {
      const db = out[i];
      out[i] = db <= -100 || !Number.isFinite(db) ? 0 : (db + 100) / 100;
    }
    return out;
  }

  /** Release the device. A page holding an open mic shows a recording
   *  indicator and costs battery, so this is not optional housekeeping. */
  stop() {
    this.active = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.ctx && this.ctx.close) { try { this.ctx.close(); } catch { /* already closed */ } }
    this.ctx = null;
    this.analyser = null;
    this._bins = null;
  }
}

/**
 * Is the microphone actually hearing music, or an empty room?
 *
 * The headphone case cannot be detected directly -- but "nothing has been
 * loud enough to be music for several seconds" is a good enough proxy to
 * tell someone their setup is not working, instead of showing them a still
 * landscape and letting them conclude the app is broken.
 *
 * @param {number} energy01 the analyser's own level reading
 * @param {number} elapsedMs how long listening has been running
 * @returns {boolean} true when it is worth saying something
 */
export function looksLikeSilence(energy01, elapsedMs, peak) {
  if (elapsedMs < 6000) return false;      // give it a moment before complaining
  return !(peak > SILENCE_PEAK_FLOOR) || energy01 < 0.02;
}

// A peak this low over several seconds means nothing musical has arrived --
// room tone and handling noise sit well under it.
export const SILENCE_PEAK_FLOOR = 0.06;
