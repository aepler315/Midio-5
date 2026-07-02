// Bootstrap: file loading UI, audio-clock-driven game loop (spec §6.1).
import { Conductor } from './core/Conductor.js';
import { ParamBus } from './core/ParamBus.js';
import { midiToTimeline } from './core/MidiAdapter.js';
import { buildDemoTimeline } from './core/DemoTimeline.js';
import { Simulation } from './sim/Simulation.js';
import { Renderer } from './render/Renderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { SimpleSynth } from './audio/SimpleSynth.js';

const STEP_MS = 1000 / 120;

const canvas = document.getElementById('stage');
const loaderEl = document.getElementById('loader');
const dropzoneEl = document.getElementById('dropzone');
const fileInputEl = document.getElementById('fileInput');
const demoBtnEl = document.getElementById('demoBtn');
const hudEl = document.getElementById('hud');

const conductor = new Conductor();
const paramBus = new ParamBus();
let audioEngine = null;
let synth = null;
let sim = null;
let renderer = null;

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
  conductor.load(timelineData);
  sim = new Simulation(conductor, paramBus);
  renderer = new Renderer(canvas);
  fitCanvas();

  simTime = 0;
  acc = 0;
  lastNowMs = audioEngine.nowMs;
  audioEngine.start(0);
  running = true;

  loaderEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  requestAnimationFrame(frame);
}

async function loadMidiFile(file) {
  await bootAudio();
  const buf = await file.arrayBuffer();
  const data = midiToTimeline(buf);
  synth.connectConductor(conductor);
  startTimeline(data);
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
  // Full 7-band stem separation + onset/BPM analysis lands in a later build
  // stage (spec §1.2). Until then, fall back to a demo click-track so the
  // real audio still plays and the visual systems still have KICK events.
  const bpmGuess = 120;
  const data = buildDemoTimeline({ bpm: bpmGuess, bars: Math.max(8, Math.round(audioBuffer.duration / (60 / bpmGuess) / 4)) });
  startTimeline(data);
  audioEngine.playBuffer(audioBuffer, 0);
}

async function loadDemo() {
  await bootAudio();
  synth.connectConductor(conductor);
  const data = buildDemoTimeline({});
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

  requestAnimationFrame(frame);
}
