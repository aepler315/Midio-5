// Bootstrap: file loading UI, audio-clock-driven game loop (spec §6.1).
import { Conductor } from './core/Conductor.js';
import { ParamBus } from './core/ParamBus.js';
import { midiToTimeline } from './core/MidiAdapter.js';
import { buildDemoTimeline } from './core/DemoTimeline.js';
import { synthesizeEnergyCurves } from './core/EnergyCurvesSynth.js';
import { audioToTimeline } from './audio/AudioAdapter.js';
import { Simulation } from './sim/Simulation.js';
import { Renderer } from './render/Renderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { SimpleSynth } from './audio/SimpleSynth.js';
import { VisionLoop } from './vision/VisionLoop.js';
import { DebugOverlay } from './ui/DebugOverlay.js';

const STEP_MS = 1000 / 120;

const canvas = document.getElementById('stage');
const loaderEl = document.getElementById('loader');
const dropzoneEl = document.getElementById('dropzone');
const fileInputEl = document.getElementById('fileInput');
const demoBtnEl = document.getElementById('demoBtn');
const progressEl = document.getElementById('progressText');
const hudEl = document.getElementById('hud');
const comboReadoutEl = document.getElementById('comboReadout');
const completePanelEl = document.getElementById('completePanel');
const completeStatsEl = document.getElementById('completeStats');
const playAgainBtnEl = document.getElementById('playAgainBtn');
const debugOverlayEl = document.getElementById('debugOverlay');
const eqCanvas = document.getElementById('eqCanvas');
const eqCtx = eqCanvas.getContext('2d');

const conductor = new Conductor();
const paramBus = new ParamBus();
let audioEngine = null;
let synth = null;
let sim = null;
let renderer = null;
let visionLoop = null;
let debugOverlay = null;

let simTime = 0;
let acc = 0;
let lastNowMs = 0;
let running = false;

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
window.addEventListener('resize', fitCanvas);

async function bootAudio() {
  if (audioEngine) return;
  audioEngine = new AudioEngine();
  await audioEngine.resume();
  synth = new SimpleSynth(audioEngine);
}

function startTimeline(timelineData) {
  fitCanvas();
  conductor.load(timelineData);
  sim = new Simulation(conductor, paramBus, {
    bpm: timelineData.bpm || 120,
    energyCurves: timelineData.energyCurves || null,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  });
  renderer = new Renderer(canvas);
  visionLoop = new VisionLoop(canvas, paramBus, sim, { enabled: false });
  debugOverlay = new DebugOverlay(debugOverlayEl, sim, paramBus, visionLoop);

  simTime = 0;
  acc = 0;
  lastNowMs = audioEngine.nowMs;
  audioEngine.start(0);
  running = true;

  loaderEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  requestAnimationFrame(frame);

  // Exposed for the debug overlay and for smoke-testing internals.
  window.__SMW = { conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay };
}

async function loadMidiFile(file) {
  await bootAudio();
  const buf = await file.arrayBuffer();
  const data = midiToTimeline(buf);
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  synth.connectConductor(conductor);
  startTimeline(data);
}

function showProgress(text) {
  progressEl.textContent = text;
  progressEl.classList.remove('hidden');
}

async function loadAudioFile(file) {
  await bootAudio();
  const buf = await file.arrayBuffer();
  let audioBuffer;
  try {
    audioBuffer = await audioEngine.decodeFile(buf);
  } catch (err) {
    alert('Could not decode audio file: ' + err.message);
    return;
  }

  showProgress('Separating into 7 frequency bands…');
  const data = await audioToTimeline(audioBuffer, {
    onProgress: ({ phase, progress }) => {
      if (phase === 'separate') showProgress(`Separating into 7 frequency bands… ${Math.round(progress * 100)}%`);
      else if (phase === 'analyze') showProgress('Detecting onsets, tempo, and downbeat…');
    },
  });
  progressEl.classList.add('hidden');

  if (data.freeTime) {
    console.warn(`Low tempo confidence (${data.confidence.toFixed(2)}) — switching to free-time, kick-reactive jumps.`);
  }
  startTimeline(data);
  audioEngine.playBuffer(audioBuffer, 0);
}

async function loadDemo() {
  await bootAudio();
  synth.connectConductor(conductor);
  const data = buildDemoTimeline({});
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  startTimeline(data);
}

function handleFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mid') || name.endsWith('.midi')) {
    loadMidiFile(file);
  } else {
    loadAudioFile(file);
  }
}

fileInputEl.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
demoBtnEl.addEventListener('click', () => loadDemo());

['dragenter', 'dragover'].forEach((ev) => dropzoneEl.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzoneEl.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => dropzoneEl.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzoneEl.classList.remove('drag');
}));
dropzoneEl.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropzoneEl.addEventListener('click', () => fileInputEl.click());

function frame(tRaf) {
  if (!running) return;
  const nowMs = audioEngine.nowMs;
  let deltaMs = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (deltaMs < 0) deltaMs = 0;
  if (deltaMs > 250) deltaMs = 250; // clamp huge gaps (tab backgrounded, breakpoint, etc.)
  acc += deltaMs;

  while (acc >= STEP_MS) {
    sim.step(STEP_MS, simTime + STEP_MS);
    simTime += STEP_MS;
    acc -= STEP_MS;
  }

  const alpha = acc / STEP_MS;
  renderer.draw(sim, alpha);
  comboReadoutEl.textContent = `×${sim.comboSystem.displayM.toFixed(1)}`;
  drawEqCrown();

  visionLoop.maybeSample(tRaf, simTime);
  debugOverlay.render();

  if (sim.fracture.isDone) {
    onSongComplete();
    return;
  }

  requestAnimationFrame(frame);
}

function drawEqCrown() {
  const w = eqCanvas.width, h = eqCanvas.height;
  eqCtx.clearRect(0, 0, w, h);
  if (!sim.energyCurves) return;
  const sens = sim.paramBus.live.eqSensitivity;
  const bands = sim.energyCurves.sampleAll(simTime);
  const barW = w / bands.length;
  for (let i = 0; i < bands.length; i++) {
    const v = Math.max(0, Math.min(1, bands[i] * sens));
    const barH = v * h;
    eqCtx.fillStyle = `hsl(${200 + i * 18}, 80%, 65%)`;
    eqCtx.fillRect(i * barW + 2, h - barH, barW - 4, barH);
  }
}

window.addEventListener('keydown', (e) => {
  if (!debugOverlay) return;
  if (e.key === '`') { debugOverlay.toggle(); }
  else if (e.key === 'v' || e.key === 'V') { debugOverlay.toggleVision(); }
});

function onSongComplete() {
  running = false;
  hudEl.classList.add('hidden');
  const combo = sim.comboSystem;
  completeStatsEl.textContent = `Peak streak: ${combo.streak} · Final combo: ×${combo.displayM.toFixed(1)}`;
  completePanelEl.classList.remove('hidden');
}

playAgainBtnEl.addEventListener('click', () => window.location.reload());
