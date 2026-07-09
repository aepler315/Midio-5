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
import { SoundfontLibrary, SynthRouter } from './audio/SoundfontLibrary.js';
import { Sf2Synth } from './audio/Sf2Synth.js';
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
const sf2InputEl = document.getElementById('sf2Input');
const sf2FolderInputEl = document.getElementById('sf2FolderInput');
const sf2DirBtnEl = document.getElementById('sf2DirBtn');
const sf2StatusEl = document.getElementById('sf2Status');
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
  // Router in front of the oscillator synth: when a soundfont is active,
  // notes play through its samples; otherwise the SimpleSynth fallback.
  synth = new SynthRouter(new SimpleSynth(audioEngine));
  applyActiveFont();
}

// --- SoundFont library (single .sf2, .zip of them, folder, or a persistent
// --- directory handle) + the in-play cycler bar. -------------------------
const fontLibrary = new SoundfontLibrary();
const sf2EngineCache = new Map(); // font entry -> Sf2Synth (buffers are per-font)

function applyActiveFont() {
  const font = fontLibrary.active;
  fontNameEl.textContent = font
    ? `${fontLibrary.activeIdx + 1}/${fontLibrary.fonts.length} · ${font.name}`
    : 'Built-in synth';
  if (!synth || !audioEngine) return; // re-applied by bootAudio once audio exists
  if (!font) { synth.sf2 = null; return; }
  let engine = sf2EngineCache.get(font);
  if (!engine) {
    try {
      engine = new Sf2Synth(audioEngine, font.parsed);
      sf2EngineCache.set(font, engine);
    } catch (err) {
      console.warn(`soundfont: could not build engine for ${font.name}:`, err.message);
      synth.sf2 = null;
      return;
    }
  }
  synth.sf2 = engine;
}
fontLibrary.onChange = applyActiveFont;

function showSf2Status() {
  const n = fontLibrary.fonts.length;
  if (n === 0) {
    sf2StatusEl.textContent = 'No .sf2 files found.';
  } else {
    sf2StatusEl.textContent = `${n} soundfont${n === 1 ? '' : 's'} loaded · active: ${fontLibrary.active.name} · cycle with ‹ › during play`;
  }
  sf2StatusEl.classList.remove('hidden');
}

sf2InputEl.addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  await fontLibrary.addFiles(e.target.files);
  showSf2Status();
  e.target.value = '';
});
sf2FolderInputEl.addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  await fontLibrary.addFiles(e.target.files);
  showSf2Status();
  e.target.value = '';
});
sf2DirBtnEl.addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker();
    await fontLibrary.useDirectory(handle);
    showSf2Status();
  } catch { /* user cancelled the picker */ }
});
if (!window.showDirectoryPicker) sf2DirBtnEl.classList.add('hidden');

// The cycler bar appears on mouse movement and fades back out after 3s of
// stillness, so it never sits over the visualization uninvited.
const FONT_BAR_IDLE_MS = 3000;
let fontBarTimer = 0;
function pokeFontBar() {
  if (!running || fontLibrary.fonts.length === 0) return;
  fontBarEl.classList.add('visible');
  clearTimeout(fontBarTimer);
  fontBarTimer = setTimeout(() => fontBarEl.classList.remove('visible'), FONT_BAR_IDLE_MS);
}
window.addEventListener('mousemove', pokeFontBar);
// A cursor resting on the bar itself shouldn't have it vanish underneath it.
fontBarEl.addEventListener('mouseenter', () => clearTimeout(fontBarTimer));
fontBarEl.addEventListener('mouseleave', pokeFontBar);
fontPrevEl.addEventListener('click', () => { fontLibrary.cycle(-1); pokeFontBar(); });
fontNextEl.addEventListener('click', () => { fontLibrary.cycle(1); pokeFontBar(); });

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
  window.__SMW = { conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay, synth, fontLibrary };
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
  fontBarEl.classList.remove('visible');
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
