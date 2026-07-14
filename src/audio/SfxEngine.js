// Lightweight game SFX synthesized with Web Audio — original one-shots in
// the spirit of classic platformers (coin chime, hit blip, miss thud, jump
// spring). No sample files, no copyrighted audio. Routes through the same
// AudioEngine master bus as the song so levels stay consistent.

export class SfxEngine {
  /** @param {import('./AudioEngine.js').AudioEngine} audioEngine */
  constructor(audioEngine) {
    this.ae = audioEngine;
    this.enabled = true;
    this._master = null;
  }

  _bus() {
    if (this._master) return this._master;
    const ctx = this.ae.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    g.connect(this.ae.master);
    this._master = g;
    return g;
  }

  /** Super-Mario-coin-flavored ascending arpeggio (original synthesis). */
  coin(vel = 1) {
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    // Two bright square blips a perfect fifth apart, classic coin feel.
    const notes = [988, 1319]; // B5, E6-ish
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const peak = 0.18 * vel;
      const start = t + i * 0.055;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(g).connect(this._bus());
      osc.start(start);
      osc.stop(start + 0.22);
    });
  }

  /** Crisp high blip for GREAT hits. */
  hit(vel = 1) {
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(this._bus());
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Soft lower chime for OK hits. */
  ok(vel = 0.8) {
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 660;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(this._bus());
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Soft thud + filtered noise for a miss. */
  miss() {
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    // Low sine thump.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(g).connect(this._bus());
    osc.start(t);
    osc.stop(t + 0.16);
    // Brief noise grit.
    const n = noiseBurst(ctx, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.value = 0.08;
    n.connect(hp).connect(ng).connect(this._bus());
    n.start(t);
  }

  /** Springy jump whoop (for auto Midio launch, optional). */
  jump(vel = 0.7) {
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(this._bus());
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Big sparkling flourish for perfect jump-note hits. */
  perfectJump(vel = 1) {
    this.coin(vel);
    // Extra sparkle above the coin pair.
    if (!this.enabled) return;
    const ctx = this.ae.ctx;
    const t = ctx.currentTime + 0.1;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, t);
    osc.frequency.exponentialRampToValueAtTime(2200, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(this._bus());
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /** Route a judgment grade to the matching SFX. */
  playGrade(grade, note = null) {
    switch (grade) {
      case 'perfect':
        if (note?.isJump) this.perfectJump(1);
        else this.coin(0.9);
        break;
      case 'great':
        this.hit(0.9);
        break;
      case 'ok':
        this.ok(0.8);
        break;
      case 'miss':
        this.miss();
        break;
      default:
        break;
    }
  }
}

function noiseBurst(ctx, dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}
