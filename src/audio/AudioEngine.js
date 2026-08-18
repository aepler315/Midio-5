// Owns the AudioContext — the master clock for the entire game (spec §0.2
// rule 2, §6.1). Every subsystem's "now" derives from ctx.currentTime.
// Because we query ctx.currentTime fresh every rAF frame rather than caching
// a performance.now()-based mirror, there is no drift to IIR-correct here.
import { outputLatencyMs, BLUETOOTH_LATENCY_FLOOR_MS } from '../core/ChoreoClock.js';

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser does not support Web Audio.');
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this._startCtxTime = null; // ctx.currentTime corresponding to song-time 0
    this._pausedAtMs = 0;
    this.playing = false;
    this.sourceNode = null;
    // When true, outputLatencyMs floors at BLUETOOTH_LATENCY_FLOOR_MS so
    // beat-anchored visuals stay on the heard beat with BT headphones that
    // under-report AudioContext.outputLatency.
    this.bluetoothLatencyMode = false;
  }

  /** @returns {Promise<boolean>} whether the context is actually running
   *  afterward -- previously unchecked, so a resume() that silently failed
   *  (or a context stuck 'suspended' for any reason) left the game
   *  rendering its first frame forever with no message, since ctx.currentTime
   *  never advances. Callers can check this and surface a real error. */
  async resume() {
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('[AudioEngine] resume() failed', err);
      }
    }
    return this.ctx.state === 'running';
  }

  start(offsetMs = 0) {
    this._startCtxTime = this.ctx.currentTime - offsetMs / 1000;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this._pausedAtMs = this.nowMs;
    this.playing = false;
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      this.sourceNode = null;
    }
  }

  /** Forget the decoded buffer from a previous raw-audio song. Without this,
   *  loading a MIDI/demo after playing raw audio leaves _audioBuffer set to
   *  the OLD song -- seekToMs (the mountain seekbar) would then start a
   *  BufferSource playing that stale audio on top of the new synth-driven
   *  song. MIDI/demo playback never calls playBuffer to set a fresh one, so
   *  nothing else would ever clear it. */
  clearBuffer() {
    this._audioBuffer = null;
  }

  get nowMs() {
    if (!this.playing || this._startCtxTime === null) return this._pausedAtMs;
    return (this.ctx.currentTime - this._startCtxTime) * 1000;
  }

  /** How far the HEARD signal lags the clock above (see ChoreoClock.js):
   *  base (buffer) latency plus the device/output path. Decorative
   *  beat-anchored visuals subtract this so their peaks line up with the
   *  sound as heard rather than as scheduled. Bluetooth latency mode
   *  raises a floor when the browser under-reports the path. */
  get outputLatencyMs() {
    const floor = this.bluetoothLatencyMode ? BLUETOOTH_LATENCY_FLOOR_MS : 0;
    return outputLatencyMs(this.ctx, floor);
  }

  decodeFile(arrayBuffer) {
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  /** Plays a decoded AudioBuffer and adopts it as the master clock's zero point. */
  playBuffer(audioBuffer, offsetSec = 0) {
    this._audioBuffer = audioBuffer;
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      this.sourceNode = null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.master);
    this.sourceNode = src;
    src.start(0, offsetSec);
    this.start(offsetSec * 1000);
    // Restore level if a previous finale faded us out.
    try {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(0.85, this.ctx.currentTime);
    } catch { /* ignore */ }
    return src;
  }

  /**
   * Seek the master clock (and buffer source, if any) to song time `ms`.
   * MIDI/SF2 paths only move the clock; buffer audio restarts the source.
   */
  seekToMs(ms) {
    const t = Math.max(0, ms);
    const wasPlaying = this.playing;
    if (this._audioBuffer) {
      if (this.sourceNode) {
        try { this.sourceNode.stop(); } catch { /* ignore */ }
        this.sourceNode = null;
      }
      if (wasPlaying) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._audioBuffer;
        src.connect(this.master);
        this.sourceNode = src;
        const offsetSec = Math.min(t / 1000, Math.max(0, this._audioBuffer.duration - 0.01));
        src.start(0, offsetSec);
      }
    }
    this._startCtxTime = this.ctx.currentTime - t / 1000;
    this._pausedAtMs = t;
    this.playing = wasPlaying;
    this.restoreLevel(0.85);
  }

  /**
   * Fade master to silence over `durationSec` (song finale / shatter).
   * Clock keeps running — only the audible level drops.
   */
  fadeToSilence(durationSec = 0.35) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.05, durationSec);
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + dur);
    } catch {
      g.value = 0;
    }
  }

  /**
   * A brief ducked dip then recovery -- the sound half of an authored cut
   * (drop / apotheosis): the mix visibly flinches on the hit frame instead
   * of just riding the continuous mix. Clock and playback are untouched.
   */
  duck(strength = 0.85, holdSec = 0.06, recoverSec = 0.25) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    const level = g.value;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(level * (1 - strength), now);
      g.setValueAtTime(level * (1 - strength), now + holdSec);
      g.linearRampToValueAtTime(level, now + holdSec + recoverSec);
    } catch {
      g.value = level;
    }
  }

  /** Instant restore of master level (new song / replay). */
  restoreLevel(level = 0.85) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(level, now);
    } catch {
      g.value = level;
    }
  }
}
