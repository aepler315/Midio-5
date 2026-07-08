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
import { Sf2Synth } from './audio/Sf2Synth.js';
import { SoundfontLibrary, SynthRouter } from './audio/SoundfontLibrary.js';
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
const sfFileInputEl = document.getElementById('sfFileInput');
const sfDirInputEl = document.getElementById('sfDirInput');
const sfDirBtnEl = document.getElementById('sfDirBtn');
const fontBarEl = document.getElementById('fontBar');
const fontPrevEl = document.getElementById('fontPrev');
const fontNameEl = document.getElementById('fontName');
const fontNextEl = document.getElementById('fontNext');

const conductor = new Conductor();
const paramBus = new ParamBus();
let audioEngine = null;
let synth = null;
let sim = null;
let renderer = null;
let visionLoop = null;
let debugOverlay = null;
let sf2Engine = null;
let fontLibrary = null;
let fontBarTimer = null;

let simTime = 0;
let acc = 0;
let lastNowMs = 0;
let running = false;

// The Stage model: the game is composed for a fixed 1280x720 stage and the
// browser scales that stage to fit the window (letterboxed via CSS
// object-fit). Sizing the backing store to the window instead put every
// fixed-pixel anchor (Midio at x=220, ground at y=480) in the top-left
// corner of large screens while canvas-fraction systems spread across the
// whole frame -- the composition only held together at one window size.
const STAGE_W = 1280, STAGE_H = 720;
function fitCanvas() {
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
}

async function bootAudio() {
  if (audioEngine) return;
  audioEngine = new AudioEngine();
  await audioEngine.resume();
  const fallback = new SimpleSynth(audioEngine);
  sf2Engine = new Sf2Synth(audioEngine);
  synth = new SynthRouter(fallback);
  synth.setSf2Engine(sf2Engine);
  fontLibrary = new SoundfontLibrary();
  fontLibrary.onChange = (active) => applyActiveFont(active);
}

function applyActiveFont(active) {
  if (sf2Engine) {
    if (active && active.data) {
      sf2Engine.loadSf2(active.data);
    } else {
      sf2Engine.loadSf2(null);
    }
  }
  if (fontNameEl) {
    fontNameEl.textContent = active ? active.name : 'No font';
  }
  pokeFontBar();
}

function pokeFontBar() {
  if (!fontBarEl) return;
  fontBarEl.classList.add('visible');
  clearTimeout(fontBarTimer);
  fontBarTimer = setTimeout(() => fontBarEl.classList.remove('visible'), 3000);
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
  window.__SMW = { conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay, synth, fontLibrary, sf2Engine };
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
// --- SoundFont UI wiring ---
if (sfFileInputEl) {
  sfFileInputEl.addEventListener('change', async (e) => {
    await bootAudio();
    if (fontLibrary) await fontLibrary.addFiles(e.target.files);
    e.target.value = '';
  });
}
if (sfDirInputEl) {
  sfDirInputEl.addEventListener('change', async (e) => {
    await bootAudio();
    if (fontLibrary) await fontLibrary.addFiles(e.target.files);
    e.target.value = '';
  });
}
if (sfDirBtnEl) {
  if (window.showDirectoryPicker) {
    sfDirBtnEl.addEventListener('click', async () => {
      try {
        const dirHandle = await window.showDirectoryPicker();
        await bootAudio();
        if (fontLibrary) await fontLibrary.useDirectory(dirHandle);
      } catch { /* user cancelled */ }
    });
  } else {
    // No File System Access API — fall back to the webkitdirectory input
    sfDirBtnEl.addEventListener('click', () => sfDirInputEl?.click());
  }
}
if (fontNextEl) fontNextEl.addEventListener('click', () => { if (fontLibrary) fontLibrary.cycle(1); });
if (fontPrevEl) fontPrevEl.addEventListener('click', () => { if (fontLibrary) fontLibrary.cycle(-1); });
// §3 UX hardening: hover holds the bar open, mouse leave re-pokes
if (fontBarEl) {
  fontBarEl.addEventListener('mouseenter', () => clearTimeout(fontBarTimer));
  fontBarEl.addEventListener('mouseleave', pokeFontBar);
}
// Mouse movement fades in the font bar during playback
window.addEventListener('mousemove', () => { if (running) pokeFontBar(); });

function frame(tRaf) {
  if (!running) return;
  const nowMs = audioEngine.nowMs;
  let deltaMs = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (deltaMs < 0) deltaMs = 0;
  if (deltaMs > 250) deltaMs = 250; // clamp huge gaps (tab backgrounded, breakpoint, etc.)
  acc += deltaMs;

  let milestoneFiredThisFrame = false;
  while (acc >= STEP_MS) {
    sim.step(STEP_MS, simTime + STEP_MS);
    simTime += STEP_MS;
    acc -= STEP_MS;
    if (sim.performer.milestoneFlash) milestoneFiredThisFrame = true;
  }

  const alpha = acc / STEP_MS;
  renderer.draw(sim, alpha);
  comboReadoutEl.textContent = `×${sim.comboSystem.displayM.toFixed(1)}`;
  if (milestoneFiredThisFrame) {
    comboReadoutEl.classList.remove('milestone-pulse');
    void comboReadoutEl.offsetWidth; // restart the CSS animation even if it's still mid-flight
    comboReadoutEl.classList.add('milestone-pulse');
  }

  visionLoop.maybeSample(tRaf, simTime);
  debugOverlay.render();

  if (sim.fracture.isDone) {
    onSongComplete();
    return;
  }

  requestAnimationFrame(frame);
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
  // Mario Paint title-screen treatment: each letter wobbles on its own beat.
  const title = completePanelEl.querySelector('h1');
  if (title && !title.dataset.wobbled) {
    title.dataset.wobbled = '1';
    title.innerHTML = [...title.textContent].map((ch, i) =>
      ch === ' ' ? ' ' : `<span class="wobble-letter" style="animation-delay:${i * 110}ms">${ch}</span>`,
    ).join('');
  }
  completePanelEl.classList.remove('hidden');
}

playAgainBtnEl.addEventListener('click', () => window.location.reload());
