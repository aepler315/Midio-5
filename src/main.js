// Bootstrap: file loading UI, audio-clock-driven game loop (spec §6.1).
import { Conductor } from './core/Conductor.js';
import { ParamBus } from './core/ParamBus.js';
import { midiToTimeline } from './core/MidiAdapter.js';
import { buildDemoTimeline } from './core/DemoTimeline.js';
import { synthesizeEnergyCurves } from './core/EnergyCurvesSynth.js';
import { audioToTimeline } from './audio/AudioAdapter.js';
import { Simulation } from './sim/Simulation.js';
import { createRenderer, resolveRendererMode } from './render/WebGLRenderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { SimpleSynth } from './audio/SimpleSynth.js';
import { SfxSynth } from './audio/SfxSynth.js';
import { Sf2Synth } from './audio/Sf2Synth.js';
import { SoundfontLibrary, SynthRouter } from './audio/SoundfontLibrary.js';
import { FontRecommender } from './audio/FontRecommender.js';
import { VisionLoop } from './vision/VisionLoop.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { generateCustomBiomeFromMidi, rememberCustomBiome } from './world/BiomeImporter.js';
import { getReducedFlash } from './ui/Accessibility.js';
import { PerfGovernor } from './render/PerfGovernor.js';
import {
  getStoredInputOffsetMs, setStoredInputOffsetMs, hasCalibrated, markCalibrated, runCalibrationScreen,
} from './ui/InputCalibration.js';
import { LoadingShow } from './ui/LoadingShow.js';

const STEP_MS = 1000 / 120;

const canvas = document.getElementById('stage');
const loaderEl = document.getElementById('loader');
const dropzoneEl = document.getElementById('dropzone');
const fileInputEl = document.getElementById('fileInput');
const demoBtnEl = document.getElementById('demoBtn');
const progressEl = document.getElementById('progressText');
const hudEl = document.getElementById('hud');
const comboReadoutEl = document.getElementById('comboReadout');
const scoreReadoutEl = document.getElementById('scoreReadout');
const completePanelEl = document.getElementById('completePanel');
const completeStatsEl = document.getElementById('completeStats');
const resultsGridEl = document.getElementById('resultsGrid');
const playAgainBtnEl = document.getElementById('playAgainBtn');
const debugOverlayEl = document.getElementById('debugOverlay');
const sfFileInputEl = document.getElementById('sfFileInput');
const sfDirInputEl = document.getElementById('sfDirInput');
const sfDirBtnEl = document.getElementById('sfDirBtn');
const fontBarEl = document.getElementById('fontBar');
const fontBarBtnEl = document.getElementById('fontBarBtn');
const fontNameEl = document.getElementById('fontName');
const settingsBtnEl = document.getElementById('settingsBtn');
const trackBadgeEl = document.getElementById('trackBadge');
const trackBadgeBtnEl = document.getElementById('trackBadgeBtn');
const trackListEl = document.getElementById('trackList');
const dragOverlayEl = document.getElementById('dragOverlay');
const fontModalEl = document.getElementById('fontModal');
const fontModalTitleEl = document.getElementById('fontModalTitle');
const fontModalCloseEl = document.getElementById('fontModalClose');
const fontModalListEl = document.getElementById('fontModalList');
const fontHiddenToggleEl = document.getElementById('fontHiddenToggle');
const fontModalFileInputEl = document.getElementById('fontModalFileInput');
const fontModalDirInputEl = document.getElementById('fontModalDirInput');
const fontModalDirBtnEl = document.getElementById('fontModalDirBtn');
const fontAuditionStatusEl = document.getElementById('fontAuditionStatus');
const filmstripEl = document.getElementById('filmstrip');
const filmstripModalEl = document.getElementById('filmstripModal');
const filmstripModalTitleEl = document.getElementById('filmstripModalTitle');
const filmstripModalCloseEl = document.getElementById('filmstripModalClose');
const filmstripModalImgEl = document.getElementById('filmstripModalImg');
const filmstripModalDownloadEl = document.getElementById('filmstripModalDownload');
const calibPanelEl = document.getElementById('calibPanel');
const calibBeaconEl = document.getElementById('calibBeacon');
const calibStatusEl = document.getElementById('calibStatus');
const calibSkipBtnEl = document.getElementById('calibSkipBtn');
const auditionPanelEl = document.getElementById('auditionPanel');
const auditionCanvasEl = document.getElementById('auditionCanvas');
const auditionTextEl = document.getElementById('auditionText');
const auditionBarFillEl = document.getElementById('auditionBarFill');

const conductor = new Conductor();
const paramBus = new ParamBus();
let audioEngine = null;
let synth = null;
let sfx = null; // judgment-feedback synth (SfxSynth), created in bootAudio
let sim = null;
let renderer = null;
let visionLoop = null;
let debugOverlay = null;
let perfGovernor = null;
let lastRafMs = null; // separate from lastNowMs (audio clock) -- tracks real rAF-to-rAF cadence for the perf governor
let sf2Engine = null;
let fontLibrary = null;
let fontRecommender = null;
let fontBarTimer = null;
let rafHandle = null; // tracks the pending frame() call so a mid-song file
                       // drop can cancel the old loop instead of stacking a
                       // second one alongside it
let fontModalView = 'list'; // 'list' (visible fonts, click-to-hide) | 'hidden' (hidden fonts, click-to-unhide)
let reducedFlash = getReducedFlash(); // The Reel (Movement VI): persisted accessibility toggle
// Input latency offset (ms, applied at DOM stamp time): seeded from storage,
// set by the one-time calibration screen, refined silently in-game by
// Simulation's LatencyCalibrator and persisted as refinements land.
let inputOffsetMs = getStoredInputOffsetMs();
let loadShow = null; // percussion loading show, created in bootAudio
let loadGen = 0;     // a newer load cancels a stale audition gate's start

let simTime = 0;
let acc = 0;
let lastNowMs = 0;
let running = false;
// Renderer path: ?renderer=webgl enables the optional WebGL post-FX overlay.
// Default remains pure Canvas 2D so drag/upload MIDI never depends on GL.
const rendererMode = resolveRendererMode(
  typeof location !== 'undefined' ? location.search : '',
);
paramBus.rendererMode = rendererMode;

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
  // Connect exactly once: `synth`/`conductor` are both persistent
  // singletons for the lifetime of the page (bootAudio itself only ever
  // runs once, guarded by the early return above), so a second connect —
  // as used to happen on every dropped MIDI file — would add a duplicate
  // listener and fire every note twice.
  synth.connectConductor(conductor);
  sfx = new SfxSynth(audioEngine);
  fontLibrary = new SoundfontLibrary();
  fontLibrary.onChange = (active) => applyActiveFont(active);
  // Auditions every font against each loaded MIDI and steers the library to
  // the best fit (see FontRecommender.js). Fonts dropped in mid-song get
  // auditioned against the current song as they land.
  fontRecommender = new FontRecommender(fontLibrary, { onUpdate: () => { renderFontModal(); updateAuditionProgress(); } });
  fontLibrary.onAdded = (font) => fontRecommender.auditionFont(font);
  // Best-effort background load — never blocks song start (§ soundfonts/README.md).
  fontLibrary.autoLoadFromServer('/soundfonts/');
  loadShow = new LoadingShow({
    canvasEl: auditionCanvasEl, textEl: auditionTextEl, barFillEl: auditionBarFillEl,
    audioEngine,
  });
}

/** The load screen's progress line/bar, fed by the recommender's onUpdate. */
function updateAuditionProgress() {
  if (!loadShow || !fontRecommender) return;
  if (!auditionPanelEl || auditionPanelEl.classList.contains('hidden')) return;
  const s = fontRecommender.status;
  const pending = fontLibrary?.fonts.find((f) => !f.hidden && f.review?.status === 'pending');
  loadShow.setProgress(s.done, s.total, pending ? pending.name : '');
}

/** One-time pre-game calibration screen. Skipped for automation (headless
 *  smoke runs can't tap in time) — the in-game calibrator covers them. */
async function maybeRunCalibration() {
  if (hasCalibrated() || navigator.webdriver) return;
  loaderEl.classList.add('hidden');
  calibPanelEl?.classList.remove('hidden');
  try {
    const off = await runCalibrationScreen({
      beaconEl: calibBeaconEl, statusEl: calibStatusEl, skipBtnEl: calibSkipBtnEl,
      tapTargetEl: calibPanelEl, audioEngine,
    });
    if (off !== null) {
      inputOffsetMs = off;
      setStoredInputOffsetMs(off);
    }
    markCalibrated();
  } finally {
    calibPanelEl?.classList.add('hidden');
  }
}

/**
 * Font ratings used to run behind the live song and lagged it badly (each
 * audition is an offline render on this same thread). Now they gate the
 * start: the percussion loading show plays this song's distilled beat while
 * the verdicts land, and the game only starts once the ratings are done —
 * with the best-fit font already on stage. No fonts loaded → no gate.
 */
async function startWithAuditionGate(data, gen) {
  const hasFonts = fontRecommender?.available && fontLibrary
    && fontLibrary.fonts.some((f) => !f.hidden);
  if (!hasFonts) {
    startTimeline(data);
    // Still arms the audition plan so fonts dropped in mid-song get rated.
    fontRecommender?.auditionForTimeline(data);
    return;
  }
  stopTimeline(); // a mid-song drop goes quiet while its ratings run
  hudEl.classList.add('hidden');
  loaderEl.classList.add('hidden');
  auditionPanelEl?.classList.remove('hidden');
  const session = loadShow?.start(data);
  loadShow?.setProgress(0, fontLibrary.fonts.filter((f) => !f.hidden).length, '');
  try {
    await fontRecommender.auditionForTimeline(data);
  } finally {
    loadShow?.stop(session);
    if (gen === loadGen) auditionPanelEl?.classList.add('hidden');
  }
  if (gen !== loadGen) return; // another file dropped during the gate
  startTimeline(data);
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
  renderFontModal();
  pokeFontBar();
}

function pokeFontBar() {
  if (!fontBarEl) return;
  fontBarEl.classList.add('visible');
  clearTimeout(fontBarTimer);
  fontBarTimer = setTimeout(() => fontBarEl.classList.remove('visible'), 3000);
}

/** Renders the SoundFont switcher popup's current view: the visible-font
 *  list (click a row to activate it, × to hide) or the hidden-font list
 *  (the "settings" view, + to restore). Re-run on every fontLibrary change
 *  (load/hide/unhide/select/cycle) so an open popup always reflects the
 *  live library, and once up front so opening it is never stale. */
function renderFontModal() {
  if (!fontModalListEl || !fontLibrary) return;
  const hiddenCount = fontLibrary.hiddenFonts.length;
  if (fontHiddenToggleEl) {
    fontHiddenToggleEl.textContent = fontModalView === 'hidden' ? '\u2190 Back' : `Hidden (${hiddenCount})`;
  }
  if (fontModalTitleEl) {
    fontModalTitleEl.textContent = fontModalView === 'hidden' ? 'Hidden SoundFonts' : 'SoundFonts';
  }

  renderAuditionStatus();

  const entries = fontModalView === 'hidden' ? fontLibrary.hiddenFonts : fontLibrary.visibleFonts;
  if (entries.length === 0) {
    const msg = fontModalView === 'hidden'
      ? 'No hidden fonts.'
      : 'No fonts loaded yet — drop .sf2/.zip into the soundfonts/ folder, or use the buttons below.';
    fontModalListEl.innerHTML = `<div class="fontListEmpty">${escapeHtml(msg)}</div>`;
    return;
  }

  const action = fontModalView === 'hidden' ? 'unhide' : 'hide';
  const glyph = fontModalView === 'hidden' ? '+' : '\u00d7';
  const title = fontModalView === 'hidden' ? 'Restore this font' : 'Hide this font';
  const recommendedIndex = fontRecommender ? fontRecommender.recommendedIndex : -1;
  fontModalListEl.innerHTML = entries.map(({ font, index }) => {
    const active = fontModalView === 'list' && index === fontLibrary.activeIndex;
    const star = (fontModalView === 'list' && index === recommendedIndex)
      ? '<span class="fontRowStar" title="Best fit for this song">★</span>'
      : '';
    return `<div class="fontRow${active ? ' active' : ''}" data-index="${index}">`
      + star
      + `<span class="fontRowName">${escapeHtml(font.name)}</span>`
      + (fontModalView === 'list' ? auditionBadge(font) : '')
      + `<button type="button" class="fontRowAction" data-action="${action}" data-index="${index}" title="${title}">${glyph}</button>`
      + `</div>`;
  }).join('');
}

/** Per-row verdict from this song's audition: fit score (0-100), warning +
 *  reason for a disqualified font, or an ellipsis while still rendering. */
function auditionBadge(font) {
  const review = font.review;
  if (!review) return '';
  if (review.status === 'pending') {
    return '<span class="fontRowBadge pending" title="Auditioning against this song…">…</span>';
  }
  if (review.status === 'disqualified') {
    return `<span class="fontRowBadge dq" title="${escapeHtml(review.reason || 'Disqualified')}">⚠</span>`;
  }
  return `<span class="fontRowBadge ok" title="Fit score for this song: ${review.score}/100">${review.score}</span>`;
}

/** The switcher popup's one-line audition summary for the current song. */
function renderAuditionStatus() {
  if (!fontAuditionStatusEl) return;
  const s = fontRecommender ? fontRecommender.status : null;
  if (!s || !s.planned || s.total === 0 || fontModalView === 'hidden') {
    fontAuditionStatusEl.classList.add('hidden');
    return;
  }
  let text;
  if (s.analyzing) {
    text = `Auditioning fonts for this song… ${s.done}/${s.total}`;
  } else if (s.allDisqualified) {
    text = 'No loaded font fits this song — using the built-in synth.';
  } else if (s.recommendedIndex >= 0) {
    const name = fontLibrary.fonts[s.recommendedIndex]?.name || '';
    text = `★ Best fit for this song: ${name}`;
  } else {
    fontAuditionStatusEl.classList.add('hidden');
    return;
  }
  fontAuditionStatusEl.textContent = text;
  fontAuditionStatusEl.classList.remove('hidden');
}

function openFontModal(view = 'list') {
  fontModalView = view;
  renderFontModal();
  fontModalEl?.classList.remove('hidden');
}

function closeFontModal() {
  fontModalEl?.classList.add('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Populates the track badge/list from a loaded MIDI's per-track breakdown
 *  (multi-track MIDI, visible somewhere). No-ops for non-MIDI sources
 *  (raw audio file / procedural demo), which carry no track metadata. */
function renderTracks(tracks, pairs) {
  if (!trackBadgeEl || !trackBadgeBtnEl || !trackListEl) return;
  const shown = (tracks || []).filter((t) => t.noteCount > 0);
  if (shown.length === 0) {
    trackBadgeEl.classList.add('hidden');
    trackBadgeEl.classList.remove('expanded');
    trackListEl.innerHTML = '';
    return;
  }

  const roleCount = new Set(shown.map((t) => t.role)).size;
  trackBadgeBtnEl.textContent =
    `${shown.length} track${shown.length === 1 ? '' : 's'} \u00b7 ${roleCount} role${roleCount === 1 ? '' : 's'}`;

  const panGlyph = (pan) => (pan <= -0.15 ? '\u25c4' : pan >= 0.15 ? '\u25ba' : '\u25cf');
  const partnerName = (track) => {
    const pair = (pairs || []).find((p) => p.channelA === track.channel || p.channelB === track.channel);
    if (!pair) return null;
    const otherChannel = pair.channelA === track.channel ? pair.channelB : pair.channelA;
    const other = shown.find((t) => t.channel === otherChannel);
    return other ? other.name : null;
  };

  const rows = shown.map((t) => {
    const partner = t.intertwined ? partnerName(t) : null;
    const title = partner ? `Widens apart from "${partner}" over the course of the song` : '';
    return `<div class="trackRow${t.intertwined ? ' intertwined' : ''}" title="${escapeHtml(title)}">`
      + `<span class="roleDot role-${t.role}"></span>`
      + `<span class="trackName">${escapeHtml(t.name)}${partner ? ' \u2194' : ''}</span>`
      + `<span class="panGlyph">${panGlyph(t.pan)}</span>`
      + `<span class="trackMeta">${t.noteCount}</span>`
      + `</div>`;
  }).join('');
  const hint = (pairs && pairs.length)
    ? '<div class="trackListHint">\u2194 tracks were mixed hard-panned opposite and play together — their stereo spread widens gradually over the song.</div>'
    : '';
  trackListEl.innerHTML = rows + hint;

  trackBadgeEl.classList.remove('hidden');
}

function toggleTrackList() {
  if (trackBadgeEl) trackBadgeEl.classList.toggle('expanded');
}

/** Tears down whatever is currently playing (if anything) so a new song can
 *  start cleanly: cancels the in-flight frame() loop (otherwise a second
 *  `requestAnimationFrame(frame)` from the new `startTimeline` would run
 *  ALONGSIDE the still-scheduled old one, double-stepping the simulation),
 *  stops any raw audio buffer mid-flight, silences any still-ringing SF2
 *  voices, and resets the UI panels a fresh song should start without. Safe
 *  to call before the very first song too (everything it touches already
 *  tolerates being idle). */
function stopTimeline() {
  running = false;
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  audioEngine?.pause();
  synth?.stopAll?.();
  // Tear down optional WebGL overlay so a mid-song drop doesn't stack layers.
  if (renderer && typeof renderer.dispose === 'function') {
    try { renderer.dispose(); } catch { /* ignore */ }
  }
  renderer = null;
  completePanelEl.classList.add('hidden');
  debugOverlayEl.classList.add('hidden');
  auditionPanelEl?.classList.add('hidden');
}

function startTimeline(timelineData) {
  stopTimeline();
  fitCanvas();
  conductor.load(timelineData);
  perfGovernor = new PerfGovernor();
  sim = new Simulation(conductor, paramBus, {
    bpm: timelineData.bpm || 120,
    energyCurves: timelineData.energyCurves || null,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    customBiome: timelineData.customBiome || null,
    inputOffsetMs,
  });
  sim.perf = perfGovernor;
  // Canvas is always the scene compositor; 'webgl' adds a non-destructive overlay.
  renderer = createRenderer(canvas, rendererMode);
  visionLoop = new VisionLoop(canvas, paramBus, sim, { enabled: false });
  debugOverlay = new DebugOverlay(debugOverlayEl, sim, paramBus, visionLoop);
  renderTracks(timelineData.tracks, timelineData.pairs);
  if (filmstripEl) { filmstripEl.innerHTML = ''; filmstripEl.classList.add('hidden'); }

  simTime = 0;
  acc = 0;
  lastNowMs = audioEngine.nowMs;
  lastRafMs = null;
  // Fresh song, fresh button: no press may carry across, and the demo/play
  // buttons must lose focus or the first Space would "click" them again.
  pressedSources.clear();
  document.activeElement?.blur?.();
  audioEngine.start(0);
  running = true;

  loaderEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  rafHandle = requestAnimationFrame(frame);

  // Exposed for the debug overlay and for smoke-testing internals.
  // `rafHandle` is a live getter (not a snapshot) so smoke tests can
  // precisely confirm stopTimeline() cancels the CURRENT pending frame
  // (rather than inferring it from run rates, which headless Chromium's
  // rAF throttling and AudioContext clock drift make unreliable to assert on).
  window.__SMW = {
    conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay, synth, fontLibrary, sf2Engine, fontRecommender,
    renderer, rendererMode, rendererBackend: renderer?.backend || 'canvas',
    customBiome: timelineData.customBiome || null,
    tracks: timelineData.tracks || [], pairs: timelineData.pairs || [],
    get rafHandle() { return rafHandle; },
  };
}

async function loadMidiFile(file) {
  try {
    await bootAudio();
    await maybeRunCalibration();
    const gen = ++loadGen;
    const buf = await file.arrayBuffer();
    if (!buf || buf.byteLength < 14) {
      throw new Error('File is empty or too small to be a MIDI file');
    }
    const data = midiToTimeline(buf);
    if (!data.timeline || data.timeline.length === 0) {
      throw new Error('MIDI parsed but contains no notes');
    }
    data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
    // Custom biome generation lives inside the load path so every drop/upload
    // of a .mid produces a unique world without changing stock demo casting.
    data.customBiome = generateCustomBiomeFromMidi(data, file.name || 'MIDI');
    rememberCustomBiome(paramBus, data.customBiome);
    // Ratings gate the start (no more mid-song audition lag): the percussion
    // loading show entertains while every font auditions against THIS midi.
    await startWithAuditionGate(data, gen);
  } catch (err) {
    console.error('[MIDI load failed]', err);
    progressEl.classList.add('hidden');
    alert('Could not load MIDI file: ' + (err?.message || err));
  }
}

function showProgress(text) {
  progressEl.textContent = text;
  progressEl.classList.remove('hidden');
}

async function loadAudioFile(file) {
  await bootAudio();
  await maybeRunCalibration();
  loadGen++; // raw audio never gates, but a pending gate must not start over us
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
  // Raw audio is its own sound source — font fit scores from the previous
  // MIDI would be stale noise here, so drop them.
  fontRecommender?.clear();
  audioEngine.playBuffer(audioBuffer, 0);
}

async function loadDemo() {
  await bootAudio();
  await maybeRunCalibration();
  const gen = ++loadGen;
  const data = buildDemoTimeline({});
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  // The demo is synth-voiced just like a MIDI file, so it gets the same gate.
  await startWithAuditionGate(data, gen);
}

function handleFile(file) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  // Also accept application/midi / audio/midi MIME when the OS omits extension.
  const mime = (file.type || '').toLowerCase();
  const isMidi = name.endsWith('.mid') || name.endsWith('.midi')
    || mime === 'audio/midi' || mime === 'audio/mid' || mime === 'application/x-midi'
    || mime === 'application/midi';
  if (isMidi) {
    loadMidiFile(file);
  } else {
    loadAudioFile(file);
  }
}

fileInputEl.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
demoBtnEl.addEventListener('click', () => loadDemo());

// Dropzone-local visual feedback only (pre-game loader screen) — the actual
// file handling lives in the window-level listeners below so a drop lands
// the same way whether it's on the dropzone, mid-song, or anywhere else on
// the page.
['dragenter', 'dragover'].forEach((ev) => dropzoneEl.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzoneEl.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => dropzoneEl.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzoneEl.classList.remove('drag');
}));
dropzoneEl.addEventListener('click', () => fileInputEl.click());

// --- Global drag-and-drop: works at ANY time, not just from the initial
// loader screen. Dropping a different .mid/audio file mid-song tears down
// the current one (stopTimeline, via startTimeline/loadMidiFile/
// loadAudioFile) and auto-plays the new one immediately. dragDepth tracks
// nested dragenter/dragleave pairs (they fire on every element the pointer
// crosses) so the overlay doesn't flicker off while still dragging over a
// child element.
let dragDepth = 0;
function isLoaderVisible() { return !loaderEl.classList.contains('hidden'); }
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  // The loader's own dropzone already gives drag feedback pre-game; the
  // overlay is only for "you can drop a new file right now" mid-song.
  if (dragOverlayEl && !isLoaderVisible()) dragOverlayEl.classList.add('visible');
});
window.addEventListener('dragover', (e) => e.preventDefault()); // required to allow drop
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0 && dragOverlayEl) dragOverlayEl.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  if (dragOverlayEl) dragOverlayEl.classList.remove('visible');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

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

// --- SoundFont switcher popup (§ replaces the old </>  cycler arrows,
// which had no way to show *which* fonts exist or let you set any aside).
// The pill in fontBar opens the visible-fonts list; the settings gear opens
// straight to the hidden-fonts ("unhide") view.
if (fontBarBtnEl) fontBarBtnEl.addEventListener('click', () => openFontModal('list'));
if (settingsBtnEl) settingsBtnEl.addEventListener('click', () => openFontModal('hidden'));
if (fontModalCloseEl) fontModalCloseEl.addEventListener('click', () => closeFontModal());
if (fontModalEl) {
  // Click on the backdrop itself (not the panel or its children) closes it.
  fontModalEl.addEventListener('click', (e) => { if (e.target === fontModalEl) closeFontModal(); });
}
if (fontHiddenToggleEl) {
  fontHiddenToggleEl.addEventListener('click', () => {
    fontModalView = fontModalView === 'hidden' ? 'list' : 'hidden';
    renderFontModal();
  });
}
if (fontModalListEl) {
  fontModalListEl.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.fontRowAction');
    if (actionBtn) {
      const idx = Number(actionBtn.dataset.index);
      if (actionBtn.dataset.action === 'hide') fontLibrary?.hide(idx);
      else fontLibrary?.unhide(idx);
      // Membership changed — the recommendation may need to move with it
      // (e.g. the starred font was just hidden).
      fontRecommender?.reapply();
      return; // don't also treat this click as a row-select
    }
    const row = e.target.closest('.fontRow');
    if (row && fontModalView === 'list') {
      // A hand-picked font is pinned for the rest of this song: the
      // recommender keeps badging but stops auto-switching.
      fontRecommender?.pinUserChoice();
      fontLibrary?.select(Number(row.dataset.index));
    }
  });
}
if (fontModalFileInputEl) {
  fontModalFileInputEl.addEventListener('change', async (e) => {
    await bootAudio();
    if (fontLibrary) await fontLibrary.addFiles(e.target.files);
    e.target.value = '';
  });
}
if (fontModalDirInputEl) {
  fontModalDirInputEl.addEventListener('change', async (e) => {
    await bootAudio();
    if (fontLibrary) await fontLibrary.addFiles(e.target.files);
    e.target.value = '';
  });
}
if (fontModalDirBtnEl) {
  if (window.showDirectoryPicker) {
    fontModalDirBtnEl.addEventListener('click', async () => {
      try {
        const dirHandle = await window.showDirectoryPicker();
        await bootAudio();
        if (fontLibrary) await fontLibrary.useDirectory(dirHandle);
      } catch { /* user cancelled */ }
    });
  } else {
    fontModalDirBtnEl.addEventListener('click', () => fontModalDirInputEl?.click());
  }
}

// §3 UX hardening: hover holds the bar open, mouse leave re-pokes
if (fontBarEl) {
  fontBarEl.addEventListener('mouseenter', () => clearTimeout(fontBarTimer));
  fontBarEl.addEventListener('mouseleave', pokeFontBar);
}
// Mouse movement fades in the font bar during playback
window.addEventListener('mousemove', () => { if (running) pokeFontBar(); });

// --- Track visibility wiring ---
if (trackBadgeBtnEl) trackBadgeBtnEl.addEventListener('click', () => toggleTrackList());

function frame(tRaf) {
  if (!running) return;
  if (lastRafMs !== null) perfGovernor.sample(tRaf - lastRafMs, tRaf);
  lastRafMs = tRaf;
  const nowMs = audioEngine.nowMs;
  let deltaMs = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (deltaMs < 0) deltaMs = 0;
  if (deltaMs > 250) deltaMs = 250; // clamp huge gaps (tab backgrounded, breakpoint, etc.)
  acc += deltaMs;

  let milestoneFiredThisFrame = false;
  judgeEventsThisFrame.length = 0;
  while (acc >= STEP_MS) {
    sim.step(STEP_MS, simTime + STEP_MS);
    simTime += STEP_MS;
    acc -= STEP_MS;
    if (sim.performer.milestoneFlash) milestoneFiredThisFrame = true;
    // Judge events are one-shot per sim step (cleared at the next step's
    // top), and several steps run per rendered frame — latch them here,
    // same pattern as the milestone flag above, so the SFX layer misses none.
    if (sim.judge.stepEvents.length) judgeEventsThisFrame.push(...sim.judge.stepEvents);
  }
  dispatchJudgeSfx(judgeEventsThisFrame);

  // Silent auto-calibration: when the sim's LatencyCalibrator decides the
  // player is steady-but-late (or -early), adopt and persist the corrected
  // offset so future presses — and future sessions — are stamped true.
  if (sim.latency && sim.latency.lastAdjustment) {
    inputOffsetMs = sim.latency.offsetMs;
    setStoredInputOffsetMs(inputOffsetMs);
    sim.latency.lastAdjustment = null;
  }

  const alpha = acc / STEP_MS;
  renderer.draw(sim, alpha);
  comboReadoutEl.textContent = `×${sim.comboSystem.displayM.toFixed(1)}`;
  if (scoreReadoutEl) scoreReadoutEl.textContent = sim.scoreKeeper.score.toLocaleString('en-US');
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

  rafHandle = requestAnimationFrame(frame);
}

// --- Player input: one logical jump button across Space + every pointer ---
// Edge-collapsed: 'down' fires only on the 0 -> 1 pressed-source transition
// and 'up' only on 1 -> 0, so keyboard+mouse together (or multi-touch) can
// never double-judge a press or drop a hold early. Timestamps are read HERE,
// in the DOM handler, on the audio clock — event-time accuracy is what the
// judge scores, never the 8.3ms sim step grid.
const pressedSources = new Set();
const judgeEventsThisFrame = [];

function anyModalOpen() {
  return (fontModalEl && !fontModalEl.classList.contains('hidden'))
    || (filmstripModalEl && !filmstripModalEl.classList.contains('hidden'));
}

function pressDown(src) {
  if (!running || !sim || !audioEngine) return;
  if (pressedSources.size === 0) sim.enqueueTap('down', audioEngine.nowMs + inputOffsetMs);
  pressedSources.add(src);
}

function pressUp(src) {
  if (!pressedSources.delete(src)) return;
  if (pressedSources.size === 0 && sim && audioEngine) {
    sim.enqueueTap('up', audioEngine.nowMs + inputOffsetMs);
  }
}

/** Tab blur / pointer cancel: a hold must never stick to a button the
 *  browser will not deliver an 'up' for. */
function releaseAllPresses() {
  if (pressedSources.size > 0 && sim && audioEngine) {
    sim.enqueueTap('up', audioEngine.nowMs + inputOffsetMs);
  }
  pressedSources.clear();
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (anyModalOpen()) return;
  e.preventDefault(); // stops page scroll, and Space "clicking" a focused button
  if (e.repeat) return;
  pressDown('key');
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') pressUp('key');
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pressDown(`ptr:${e.pointerId}`);
});
window.addEventListener('pointerup', (e) => pressUp(`ptr:${e.pointerId}`));
window.addEventListener('pointercancel', (e) => pressUp(`ptr:${e.pointerId}`));
window.addEventListener('blur', releaseAllPresses);

// SFX cap per rendered frame: a tab-restore burst can run ~30 sim steps
// under the 250ms clamp, and thirty simultaneous plucks is a noise-bomb.
const SFX_MAX_PER_FRAME = 4;

/** Feedback sounds for the frame's latched judge events. Audio lives here
 *  (not in Simulation) so the sim stays constructible in node tests; the
 *  cost is at most one rAF of delay on feedback-only sounds. */
function dispatchJudgeSfx(events) {
  if (!sfx || events.length === 0) return;
  const tonicPc = sim?.vibe?.tonic ?? 0;
  const conf = sim?.vibe?.tonicConfidence ?? 0;
  let played = 0;
  for (const evt of events) {
    if (played >= SFX_MAX_PER_FRAME) break;
    switch (evt.kind) {
      case 'hit': sfx.judgment(evt.tier, tonicPc, conf); played++; break;
      case 'holdStart': sfx.judgment(evt.tier ?? 'good', tonicPc, conf); played++; break;
      case 'sour': sfx.judgment('sour', tonicPc, conf); played++; break;
      case 'miss': sfx.miss(); played++; break;
      case 'holdTick': sfx.holdTick(evt.tickIdx, tonicPc, conf); played++; break;
      case 'holdComplete': sfx.holdComplete(tonicPc, conf); played++; break;
      case 'holdChoke': sfx.holdChoke(); played++; break;
      default: break;
    }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (fontModalEl && !fontModalEl.classList.contains('hidden')) closeFontModal();
    if (filmstripModalEl && !filmstripModalEl.classList.contains('hidden')) closeFilmstripModal();
    return;
  }
  if (e.key === 'f' || e.key === 'F') { openFontModal('list'); return; }
  if (e.key === 'r' || e.key === 'R') { toggleReducedFlash(); return; }
  if (!debugOverlay) return;
  if (e.key === '`') { debugOverlay.toggle(); }
  else if (e.key === 'v' || e.key === 'V') { debugOverlay.toggleVision(); }
  else if (e.key === 't' || e.key === 'T') { toggleTrackList(); }
});

/** The Reel (Movement VI): live-toggle + persist the reduced-flash
 *  accessibility setting, cascading into the running sim if there is one. */
function toggleReducedFlash() {
  reducedFlash = !reducedFlash;
  setReducedFlash(reducedFlash);
  sim?.setReducedFlash(reducedFlash);
}

function onSongComplete() {
  running = false;
  pressedSources.clear();
  hudEl.classList.add('hidden');
  const combo = sim.comboSystem;
  const sk = sim.scoreKeeper;
  // The real high-water mark, not the live streak the freeze happened to catch.
  completeStatsEl.textContent = `Peak streak: ${sk.peakStreak} · Final combo: ×${combo.displayM.toFixed(1)}`;
  if (resultsGridEl) {
    const c = sk.counts;
    const acc = sk.accuracyPct;
    const holdsTotal = sim.noteChart.holdCount;
    resultsGridEl.innerHTML = `
      <div class="rGrade">${sk.grade ?? '—'}</div>
      <div class="rRows">
        <div class="rRow"><span>Score</span><b>${sk.score.toLocaleString('en-US')}</b></div>
        <div class="rRow"><span>Timing</span><b>${acc === null ? '—' : acc.toFixed(1) + '%'}</b></div>
        <div class="rRow rTiers">
          <span class="tPerfect">${c.perfect} perfect</span>
          <span class="tGreat">${c.great} great</span>
          <span class="tGood">${c.good} good</span>
          <span class="tSour">${c.sour} sour</span>
          <span class="tMiss">${sk.misses} missed</span>
        </div>
        ${holdsTotal > 0 ? `<div class="rRow"><span>Holds ridden</span><b>${sk.holdsCompleted} / ${holdsTotal}</b></div>` : ''}
      </div>`;
    resultsGridEl.classList.remove('hidden');
  }
  // Mario Paint title-screen treatment: each letter wobbles on its own beat.
  const title = completePanelEl.querySelector('h1');
  if (title && !title.dataset.wobbled) {
    title.dataset.wobbled = '1';
    title.innerHTML = [...title.textContent].map((ch, i) =>
      ch === ' ' ? ' ' : `<span class="wobble-letter" style="animation-delay:${i * 110}ms">${ch}</span>`,
    ).join('');
  }
  renderFilmstrip(sim.highlightReel?.frames || []);
  completePanelEl.classList.remove('hidden');
}

/** The Reel: the COMPLETE panel's highlight filmstrip -- proof of what the
 *  song just did. Click a frame to enlarge it; the modal offers a
 *  per-frame download link. */
function renderFilmstrip(frames) {
  if (!filmstripEl) return;
  if (!frames.length) {
    filmstripEl.innerHTML = '';
    filmstripEl.classList.add('hidden');
    return;
  }
  filmstripEl.classList.remove('hidden');
  filmstripEl.innerHTML = frames.map((f, i) =>
    `<button type="button" class="filmstripFrame" data-index="${i}" title="${escapeHtml(f.label)}">`
    + `<img src="${f.dataUrl}" alt="${escapeHtml(f.label)}" /></button>`,
  ).join('');
}

function openFilmstripModal(frame) {
  if (!filmstripModalEl) return;
  filmstripModalTitleEl.textContent = frame.label;
  filmstripModalImgEl.src = frame.dataUrl;
  filmstripModalImgEl.alt = frame.label;
  const slug = frame.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  filmstripModalDownloadEl.href = frame.dataUrl;
  filmstripModalDownloadEl.download = `super-midio-world-${slug}-${Math.round(frame.atMs)}ms.jpg`;
  filmstripModalEl.classList.remove('hidden');
}

function closeFilmstripModal() {
  filmstripModalEl?.classList.add('hidden');
}

if (filmstripEl) {
  filmstripEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.filmstripFrame');
    if (!btn) return;
    const frame = sim?.highlightReel?.frames?.[Number(btn.dataset.index)];
    if (frame) openFilmstripModal(frame);
  });
}
if (filmstripModalCloseEl) filmstripModalCloseEl.addEventListener('click', closeFilmstripModal);
if (filmstripModalEl) {
  filmstripModalEl.addEventListener('click', (e) => { if (e.target === filmstripModalEl) closeFilmstripModal(); });
}

playAgainBtnEl.addEventListener('click', () => window.location.reload());
