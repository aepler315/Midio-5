// Sample-playback synth over a parsed SoundFont: same one-method surface
// as SimpleSynth (noteOn(evt)), so the router can swap between them live.
// Each voice is an AudioBufferSourceNode over the font's whole sample pool
// (offset + absolute loop points select the sample) through an ADSR gain.
import { Role } from '../core/NoteEvent.js';

const NOMINAL_RATE = 44100; // pool buffer rate; per-sample rates fold into playbackRate
const MAX_VOICES = 48;
const ROLE_PROGRAMS = {
  // Preferred GM programs per role, first available wins; bank 0 fallback is "anything".
  [Role.MELODY]: [80, 81, 73, 40, 0],
  [Role.BASS]: [33, 32, 38, 34, 0],
  [Role.PAD]: [89, 88, 91, 48, 0],
};

export class Sf2Synth {
  constructor(audioEngine, font) {
    this.ae = audioEngine;
    this.font = font;
    this.enabled = true;
    this._voices = [];

    // One Float32 buffer for the whole pool, built once per font.
    const ctx = audioEngine.ctx;
    const data = font.sampleData;
    this.buffer = ctx.createBuffer(1, Math.max(1, data.length), NOMINAL_RATE);
    const ch = this.buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) ch[i] = data[i] / 32768;

    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(audioEngine.master);

    // Role -> preset resolution, done once.
    this._rolePreset = {};
    for (const role of [Role.MELODY, Role.BASS, Role.PAD]) {
      this._rolePreset[role] = this._findPreset(0, ROLE_PROGRAMS[role]);
    }
    this._drumPreset = this._findPreset(128, [0]) || this._anyInBank(128);
  }

  _findPreset(bank, programs) {
    for (const prog of programs) {
      const hit = this.font.presets.get(bank * 128 + prog);
      if (hit) return hit;
    }
    return this._anyInBank(bank);
  }

  _anyInBank(bank) {
    for (const [key, preset] of this.font.presets) {
      if (Math.floor(key / 128) === bank) return preset;
    }
    return null;
  }

  noteOn(evt) {
    if (!this.enabled) return;
    const preset = evt.role === Role.RHYTHM ? this._drumPreset : (this._rolePreset[evt.role] || this._rolePreset[Role.MELODY]);
    if (!preset) return;
    const key = Math.max(0, Math.min(127, Math.round(evt.pitch ?? 60)));
    const vel127 = Math.max(1, Math.min(127, Math.round((evt.vel ?? 0.7) * 127)));

    let layered = 0;
    for (const z of preset.zones) {
      if (key < z.keyLo || key > z.keyHi || vel127 < z.velLo || vel127 > z.velHi) continue;
      this._startVoice(z, key, evt);
      if (++layered >= 2) break; // cap stacked layers per note
    }
  }

  _startVoice(z, key, evt) {
    const ctx = this.ae.ctx;
    const s = this.font.samples[z.sampleIdx];
    if (!s) return;
    const t = ctx.currentTime;

    const start = s.start + z.startOfs;
    const end = s.end + z.endOfs;
    if (end <= start) return;
    const root = z.rootKey >= 0 ? z.rootKey : s.originalKey;
    const semis = (key - root) + z.coarse + (z.fine + s.correction) / 100;
    const rate = Math.pow(2, semis / 12) * (s.sampleRate / NOMINAL_RATE);

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    const looped = (z.modes === 1 || z.modes === 3) && s.loopEnd > s.loopStart;
    if (looped) {
      src.loop = true;
      src.loopStart = (s.loopStart + z.loopStartOfs) / NOMINAL_RATE;
      src.loopEnd = (s.loopEnd + z.loopEndOfs) / NOMINAL_RATE;
    }

    // ADSR: attack -> hold -> decay to sustain, release scheduled off durMs.
    const velGain = Math.pow((evt.vel ?? 0.7), 1.1);
    const peak = velGain * Math.pow(10, -Math.max(0, z.attenuation) / 200);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, z.attack));
    const decayStart = t + z.attack + z.hold;
    g.gain.setTargetAtTime(Math.max(0.0001, peak * z.sustain), decayStart, Math.max(0.01, z.decay / 4));

    const durSec = Math.max(0.06, (evt.durMs ?? 300) / 1000);
    const tRel = t + durSec;
    const relTau = Math.max(0.02, Math.min(2, z.release) / 4);
    g.gain.setTargetAtTime(0.0001, tRel, relTau);

    src.connect(g).connect(this.out);
    src.start(t, start / NOMINAL_RATE);
    const stopAt = looped ? tRel + relTau * 5 + 0.05 : Math.min(tRel + relTau * 5, t + (end - start) / NOMINAL_RATE / Math.max(0.01, rate)) + 0.05;
    src.stop(stopAt);

    this._voices.push(src);
    src.onended = () => {
      const i = this._voices.indexOf(src);
      if (i >= 0) this._voices.splice(i, 1);
    };
    if (this._voices.length > MAX_VOICES) {
      const oldest = this._voices.shift();
      try { oldest.stop(); } catch { /* already stopped */ }
    }
  }
}
