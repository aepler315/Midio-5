export interface AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
  started: boolean;
  muted: boolean;
  bpm: number;
  energy: number;
  kickQueue: number[];
  nextKickAudio: number;
  patternStart: number;
  beatIndex: number;
}

function envGain(ctx: AudioContext, dest: AudioNode, peak: number, attack: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + attack + decay);
  g.connect(dest);
  return g;
}

function kick(ctx: AudioContext, dest: AudioNode, when: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(148, when);
  osc.frequency.exponentialRampToValueAtTime(38, when + 0.14);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.9, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + 0.24);

  const click = ctx.createOscillator();
  const cg = ctx.createGain();
  click.type = "triangle";
  click.frequency.value = 980;
  cg.gain.setValueAtTime(0.12, when);
  cg.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  click.connect(cg);
  cg.connect(dest);
  click.start(when);
  click.stop(when + 0.04);
}

function hat(ctx: AudioContext, dest: AudioNode, when: number, open = false) {
  const buf = ctx.createBuffer(1, 0.08 * ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "highpass";
  bp.frequency.value = open ? 5200 : 7800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(open ? 0.07 : 0.045, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (open ? 0.14 : 0.045));
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(when);
  src.stop(when + 0.16);
}

function bass(ctx: AudioContext, dest: AudioNode, when: number, freq: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.22, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + 0.3);
}

function pad(ctx: AudioContext, dest: AudioNode, when: number, freqs: number[]) {
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.045, when + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, when + 1.8);
    osc.connect(g);
    g.connect(dest);
    osc.start(when);
    osc.stop(when + 1.85);
  }
}

const BASS_DEGREES = [55, 55, 73.4, 82.4, 55, 49, 73.4, 82.4];

export function createAudio(): AudioEngine {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const master = ctx.createGain();
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  master.gain.value = 0.85;
  music.gain.value = 0.9;
  sfx.gain.value = 0.7;
  music.connect(master);
  sfx.connect(master);
  master.connect(analyser);
  analyser.connect(ctx.destination);
  return {
    ctx,
    master,
    music,
    sfx,
    analyser,
    bins: new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>,
    started: false,
    muted: false,
    bpm: 118,
    energy: 0.2,
    kickQueue: [],
    nextKickAudio: 0,
    patternStart: 0,
    beatIndex: 0,
  };
}

export function unlockAudio(a: AudioEngine) {
  if (a.ctx.state === "suspended") void a.ctx.resume();
}

export function startTransport(a: AudioEngine) {
  unlockAudio(a);
  if (a.started) return;
  a.started = true;
  a.patternStart = a.ctx.currentTime + 0.08;
  a.nextKickAudio = a.patternStart;
  a.beatIndex = 0;
  scheduleAhead(a);
}

function scheduleAhead(a: AudioEngine) {
  if (!a.started) return;
  const ctx = a.ctx;
  const look = 0.55;
  const beat = 60 / a.bpm;
  while (a.nextKickAudio < ctx.currentTime + look) {
    const when = a.nextKickAudio;
    const i = a.beatIndex;
    const isKick = i % 2 === 0 || i % 8 === 5;
    if (isKick) {
      kick(ctx, a.music, when);
      a.kickQueue.push(when);
    }
    hat(ctx, a.music, when, i % 4 === 3);
    if (i % 2 === 0) {
      const deg = BASS_DEGREES[(i / 2) % BASS_DEGREES.length]!;
      bass(ctx, a.music, when, deg);
    }
    if (i % 16 === 0) pad(ctx, a.music, when, [220, 277, 330]);
    a.beatIndex++;
    a.nextKickAudio += beat;
  }
}

export function pollAudio(a: AudioEngine, nowMs: number) {
  if (a.started && a.ctx.state === "running") scheduleAhead(a);
  a.analyser.getByteFrequencyData(a.bins);
  const bins = a.bins;
  let low = 0,
    mid = 0,
    high = 0;
  const n = bins.length;
  for (let i = 0; i < n; i++) {
    const v = bins[i]! / 255;
    if (i < n * 0.12) low += v;
    else if (i < n * 0.45) mid += v;
    else high += v;
  }
  const lowN = low / Math.max(1, n * 0.12);
  const midN = mid / Math.max(1, n * 0.33);
  const highN = high / Math.max(1, n * 0.55);
  a.energy = Math.min(1, lowN * 0.7 + midN * 0.35 + highN * 0.2);
  while (a.kickQueue.length > 24) a.kickQueue.shift();
  void nowMs;
}

export function setMuted(a: AudioEngine, muted: boolean) {
  a.muted = muted;
  a.master.gain.setTargetAtTime(muted ? 0.0001 : 0.85, a.ctx.currentTime, 0.04);
}

export function landThump(a: AudioEngine) {
  if (!a.started || a.muted) return;
  const ctx = a.ctx;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(42, ctx.currentTime + 0.12);
  g.gain.setValueAtTime(0.22, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
  osc.connect(g);
  g.connect(a.sfx);
  osc.start();
  osc.stop(ctx.currentTime + 0.16);
}

export function grabTick(a: AudioEngine) {
  if (!a.started || a.muted) return;
  const ctx = a.ctx;
  const osc = ctx.createOscillator();
  const g = envGain(ctx, a.sfx, 0.08, 0.004, 0.06);
  osc.type = "square";
  osc.frequency.value = 420 + Math.random() * 80;
  osc.connect(g);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}
