// Minimal role-aware synth so MIDI-sourced timelines (which carry no audio
// of their own) are audible: oscillator tones for MELODY/BASS/PAD, a pitched
// sine-sweep kick + filtered noise bursts for RHYTHM. Not a GM synth — just
// enough to make "audio-clock-mastered" mean something for .mid input.
// Every voice is routed through _connectOut() so a note's evt.pan (authored
// MIDI CC#10, or the intertwined-pair pan-out curve) is audible even on the
// no-soundfont fallback path.
import { Role } from '../core/NoteEvent.js';

export class SimpleSynth {
  constructor(audioEngine) {
    this.ae = audioEngine;
    this.enabled = true;
  }

  connectConductor(conductor) {
    return conductor.on('*', (evt) => this.noteOn(evt));
  }

  noteOn(evt) {
    if (!this.enabled) return;
    if (evt.role === Role.RHYTHM) this._drum(evt);
    else this._tone(evt);
  }

  /** Connects `node` to master, inserting a StereoPannerNode when pan is non-negligible. */
  _connectOut(node, pan) {
    const ctx = this.ae.ctx;
    if (pan && Math.abs(pan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(this.ae.master);
    } else {
      node.connect(this.ae.master);
    }
  }

  _tone(evt) {
    const ctx = this.ae.ctx;
    const t = ctx.currentTime;
    const freq = 440 * Math.pow(2, (evt.pitch - 69) / 12);
    const osc = ctx.createOscillator();
    osc.type = evt.role === Role.BASS ? 'sawtooth' : evt.role === Role.PAD ? 'triangle' : 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const peak = (evt.role === Role.PAD ? 0.10 : 0.16) * evt.vel;
    const dur = Math.max(0.08, evt.durMs / 1000);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    this._connectOut(gain, evt.pan);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _drum(evt) {
    const t = this.ae.ctx.currentTime;
    if (evt.pitch === 35 || evt.pitch === 36) this._kick(t, evt.vel, evt.pan);
    else if (evt.pitch === 38 || evt.pitch === 40) this._noiseBurst(t, evt.vel, 1200, 0.12, evt.pan);
    else this._noiseBurst(t, evt.vel * 0.7, 6000, 0.05, evt.pan);
  }

  _kick(t, vel, pan) {
    const ctx = this.ae.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    gain.gain.setValueAtTime(0.9 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    this._connectOut(gain, pan);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  _noiseBurst(t, vel, hpFreq, dur, pan) {
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
    gain.gain.value = 0.5 * vel;
    src.connect(hp).connect(gain);
    this._connectOut(gain, pan);
    src.start(t);
  }
}

