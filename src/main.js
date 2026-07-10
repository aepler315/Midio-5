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
let rafHandle = null; // tracks the pending frame() call so a mid-song file
                       // drop can cancel the old loop instead of stacking a
                       // second one alongside it
let fontModalView = 'list'; // 'list' (visible fonts, click-to-hide) | 'hidden' (hidden fonts, click-to-unhide)

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
  // Connect exactly once: `synth`/`conductor` are both persistent
  // singletons for the lifetime of the page (bootAudio itself only ever
  // runs once, guarded by the early return above), so a second connect —
  // as used to happen on every dropped MIDI file — would add a duplicate
  // listener and fire every note twice.
  synth.connectConductor(conductor);
  fontLibrary = new SoundfontLibrary();
  fontLibrary.onChange = (active) => applyActiveFont(active);
  // Best-effort background load — never blocks song start (§ soundfonts/README.md).
  fontLibrary.autoLoadFromServer('/soundfonts/');
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
  fontModalListEl.innerHTML = entries.map(({ font, index }) => {
    const active = fontModalView === 'list' && index === fontLibrary.activeIndex;
    return `<div class="fontRow${active ? ' active' : ''}" data-index="${index}">`
      + `<span class="fontRowName">${escapeHtml(font.name)}</span>`
      + `<button type="button" class="fontRowAction" data-action="${action}" data-index="${index}" title="${title}">${glyph}</button>`
      + `</div>`;
  }).join('');
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
  completePanelEl.classList.add('hidden');
  debugOverlayEl.classList.add('hidden');
}

function startTimeline(timelineData) {
  stopTimeline();
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
  renderTracks(timelineData.tracks, timelineData.pairs);

  simTime = 0;
  acc = 0;
  lastNowMs = audioEngine.nowMs;
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
    conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay, synth, fontLibrary, sf2Engine,
    tracks: timelineData.tracks || [], pairs: timelineData.pairs || [],
    get rafHandle() { return rafHandle; },
  };
}

async function loadMidiFile(file) {
  await bootAudio();
  const buf = await file.arrayBuffer();
  const data = midiToTimeline(buf);
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
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
      return; // don't also treat this click as a row-select
    }
    const row = e.target.closest('.fontRow');
    if (row && fontModalView === 'list') fontLibrary?.select(Number(row.dataset.index));
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

  rafHandle = requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (fontModalEl && !fontModalEl.classList.contains('hidden')) closeFontModal();
    return;
  }
  if (e.key === 'f' || e.key === 'F') { openFontModal('list'); return; }
  if (!debugOverlay) return;
  if (e.key === '`') { debugOverlay.toggle(); }
  else if (e.key === 'v' || e.key === 'V') { debugOverlay.toggleVision(); }
  else if (e.key === 't' || e.key === 'T') { toggleTrackList(); }
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

// Fix: attach the importer without breaking existing MIDI
const importer = new (await import("./world/BiomeImporter.js")).default;
canvas.addEventListener("drop", (e) => importer.handleDrop(e, Conductor, ParamBus));

