// Owns the AudioContext — the master clock for the entire game (spec §0.2
// rule 2, §6.1). Every subsystem's "now" derives from ctx.currentTime.
// Because we query ctx.currentTime fresh every rAF frame rather than caching
// a performance.now()-based mirror, there is no drift to IIR-correct here.
export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this._startCtxTime = null; // ctx.currentTime corresponding to song-time 0
    this._pausedAtMs = 0;
    this.playing = false;
    this.sourceNode = null;
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
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

  get nowMs() {
    if (!this.playing || this._startCtxTime === null) return this._pausedAtMs;
    return (this.ctx.currentTime - this._startCtxTime) * 1000;
  }

  decodeFile(arrayBuffer) {
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  /** Plays a decoded AudioBuffer and adopts it as the master clock's zero point. */
  playBuffer(audioBuffer, offsetSec = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.master);
    this.sourceNode = src;
    src.start(0, offsetSec);
    this.start(offsetSec * 1000);
    return src;
  }
}
