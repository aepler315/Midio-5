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
import { getReducedFlash, setReducedFlash } from './ui/Accessibility.js';
import { PerfGovernor, resolvePerfStartLevel, MAX_LEVEL as PERF_MAX_LEVEL } from './render/PerfGovernor.js';
import { emaFps, resolveFpsHudVisible } from './render/FpsMeter.js';
import { LoadingShow } from './ui/LoadingShow.js';
import { pinchZoomDelta } from './sim/ZoomDirector.js';
import { resolveDurationMs } from './core/SongDuration.js';
import { VideoExporter, exportDims, exportFilename } from './export/VideoExporter.js';
import { resolveIdentity } from './lyrics/SongIdentity.js';
import { fetchLyricsCached } from './lyrics/LyricsClient.js';
import { toBlocks, labelBlocks } from './lyrics/LyricStructure.js';
import { isVocalStemName, vocalActivity, syllableOnsets, alignBlocks } from './lyrics/StemAlign.js';

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
const exportResEl = document.getElementById('exportRes');
const exportFpsEl = document.getElementById('exportFps');
const exportBtnEl = document.getElementById('exportBtn');
const exportDownloadEl = document.getElementById('exportDownload');
const recordingHudEl = document.getElementById('recordingHud');
const recordingTimeEl = document.getElementById('recordingTime');
const recordingCancelBtnEl = document.getElementById('recordingCancelBtn');
const liveRecHudEl = document.getElementById('liveRecHud');
const saveVideoBtnEl = document.getElementById('saveVideoBtn');
const debugOverlayEl = document.getElementById('debugOverlay');
const fpsHudEl = document.getElementById('fpsHud');
const sfFileInputEl = document.getElementById('sfFileInput');
const sfDirInputEl = document.getElementById('sfDirInput');
const sfDirBtnEl = document.getElementById('sfDirBtn');
const fontBarEl = document.getElementById('fontBar');
const fontBarBtnEl = document.getElementById('fontBarBtn');
const fontNameEl = document.getElementById('fontName');
const settingsBtnEl = document.getElementById('settingsBtn');
const fullscreenBtnEl = document.getElementById('fullscreenBtn');
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
const auditionPanelEl = document.getElementById('auditionPanel');
const auditionHeadingEl = document.getElementById('auditionHeading');
const auditionCanvasEl = document.getElementById('auditionCanvas');
const auditionTextEl = document.getElementById('auditionText');
const auditionBarFillEl = document.getElementById('auditionBarFill');
const lyricsRowEl = document.getElementById('lyricsRow');
const lyricsStatusEl = document.getElementById('lyricsStatus');
const lyricsFieldsEl = document.getElementById('lyricsFields');
const lyricsArtistInputEl = document.getElementById('lyricsArtistInput');
const lyricsTitleInputEl = document.getElementById('lyricsTitleInput');
const lyricsFindBtnEl = document.getElementById('lyricsFindBtn');
const lyricsSkipBtnEl = document.getElementById('lyricsSkipBtn');

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
// Set per load path (true only for raw decoded audio, which already has
// every voice baked into the buffer) and read by applySynthMutePolicy().
let muteTimelineSynth = false;
let loadShow = null; // percussion loading show, created in bootAudio
let loadGen = 0;     // a newer load cancels a stale audition gate's start

// Retained so "Play again" and video export can replay the exact same song
// without a page reload (the sim is fully seeded + autoplay-driven, so
// replaying `lastTimelineData` reproduces the performance bit-for-bit).
// `lastAudioBuffer` is only set on the raw-audio-file path (MIDI/demo
// regenerate their sound from the timeline).
let lastTimelineData = null;
let lastAudioBuffer = null;
let lastSongName = 'song';
let videoExporter = null;
let exporting = false;
// 'live' = the ordinary play, auto-recorded at whatever the export row is
// set to, offered as "Save video" at the end; 'replay' = the explicit
// "Re-export at these settings" button's own replay -- that one still
// auto-downloads on completion, same as before. Only 'replay' recordings
// skip PerfGovernor sampling (a deliberate re-record should never shed
// phenomena mid-video); the ordinary live play behaves exactly as it
// always has, recording alongside it.
let recordingMode = null;
let pendingSaveUrl = null;
let pendingSaveLabel = '';

let simTime = 0;
let acc = 0;
let lastNowMs = 0;
let running = false;
let fpsHudVisible = resolveFpsHudVisible(typeof location !== 'undefined' ? location.search : '');
let fpsEma = null;
fpsHudEl?.classList.toggle('hidden', !fpsHudVisible);
// Renderer path: ?renderer=webgl enables the optional WebGL post-FX overlay.
// Default remains pure Canvas 2D so drag/upload MIDI never depends on GL.
const rendererMode = resolveRendererMode(
  typeof location !== 'undefined' ? location.search : '',
);
paramBus.rendererMode = rendererMode;

// Perf tier: ?perf=lite|high overrides; otherwise a coarse-pointer/small-
// viewport device heuristic starts a phone a rung down so the first
// second of play is already smooth instead of janky-then-corrected.
const perfStartLevel = resolvePerfStartLevel(
  typeof location !== 'undefined' ? location.search : '',
  {
    isCoarsePointer: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
    isSmallViewport: typeof window !== 'undefined' && Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 700,
  },
);

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

function applySynthMutePolicy() {
  // Audio-file playback already has the song in the buffer — stacking the
  // synthetic hi-hat / click / kick voices on top is what the player hears as
  // the unwanted metronome layer. MIDI and the procedural demo need the synth.
  if (synth) synth.enabled = !muteTimelineSynth;
}

// --- Fullscreen ---
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
async function toggleFullscreen() {
  const root = document.documentElement;
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } else if (root.requestFullscreen) {
      await root.requestFullscreen();
    } else if (root.webkitRequestFullscreen) {
      await root.webkitRequestFullscreen();
    }
  } catch (err) {
    console.warn('[fullscreen]', err);
  }
  updateFullscreenBtn();
}
function updateFullscreenBtn() {
  if (!fullscreenBtnEl) return;
  fullscreenBtnEl.title = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  fullscreenBtnEl.setAttribute('aria-pressed', isFullscreen() ? 'true' : 'false');
}
if (fullscreenBtnEl) fullscreenBtnEl.addEventListener('click', () => toggleFullscreen());
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);

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

  // Casting: who performs this track (Casting.js lanes) -- shown as the
  // performer's initial so the delegation is visible, not guessed at.
  const laneGlyph = (lane) => {
    if (lane === 'MIDASUS') return '<span class="laneTag" title="Danced by Midasus (clean melody)">\u2726 Midasus</span>';
    if (lane === 'BROSHI') return '<span class="laneTag" title="Hopped by Broshi (bass line)">\u25b8 Broshi</span>';
    if (lane === 'MIDIO') return '<span class="laneTag" title="Ridden by Midio (lead line)">\u2605 Midio</span>';
    return '';
  };
  const rows = shown.map((t) => {
    const partner = t.intertwined ? partnerName(t) : null;
    const title = partner ? `Widens apart from "${partner}" over the course of the song` : '';
    return `<div class="trackRow${t.intertwined ? ' intertwined' : ''}" title="${escapeHtml(title)}">`
      + `<span class="roleDot role-${t.role}"></span>`
      + `<span class="trackName">${escapeHtml(t.name)}${partner ? ' \u2194' : ''}</span>`
      + laneGlyph(t.lane)
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
  // A mid-export file drop or restart must not leave a live recorder behind.
  if (videoExporter?.active) {
    videoExporter.abort();
    exporting = false;
    recordingMode = null;
    recordingHudEl?.classList.add('hidden');
    liveRecHudEl?.classList.add('hidden');
  }
  // An unsaved recording from the play that just ended doesn't carry over --
  // starting something new discards it (it was already offered via "Save
  // video" on the complete panel, which is going away right now too).
  if (pendingSaveUrl) { URL.revokeObjectURL(pendingSaveUrl); pendingSaveUrl = null; }
  saveVideoBtnEl?.classList.add('hidden');
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

function startTimeline(timelineData, { autoRecord = true } = {}) {
  stopTimeline();
  fitCanvas();
  applySynthMutePolicy();
  // Guard a degenerate declared duration (<=0): without it, FractureEngine's
  // idle -> about-to-freeze transition never fires and the song never
  // completes -- the engine would just run forever.
  timelineData.durationMs = resolveDurationMs(timelineData.timeline, timelineData.durationMs);
  lastTimelineData = timelineData;
  lastAudioBuffer = null; // audio-file path sets this itself, right after this call
  conductor.load(timelineData);
  perfGovernor = new PerfGovernor({ startLevel: perfStartLevel });
  sim = new Simulation(conductor, paramBus, {
    bpm: timelineData.bpm || 120,
    energyCurves: timelineData.energyCurves || null,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    customBiome: timelineData.customBiome || null,
    // ChoreoClock: live output-latency getter so beat-anchored envelopes
    // peak when the EAR gets the beat (Bluetooth can lag 200ms+).
    outputLatencyMs: () => audioEngine.outputLatencyMs,
    lyricSections: timelineData.lyricSections || null,
  });
  sim.perf = perfGovernor;
  // Exposed for DebugOverlay only -- resolved song identity has no other
  // consumer in the sim itself (SectionFusion already folded the lyric
  // structure into BiomeManager.sections by this point).
  sim.lyricIdentity = timelineData.lyricIdentity || null;
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
  // Fresh song, fresh button: the demo/play buttons must lose focus or the
  // first Space would "click" them again instead of toggling the zoom.
  zoomKeyDir = 0;
  document.activeElement?.blur?.();
  audioEngine.start(0);
  running = true;

  loaderEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  rafHandle = requestAnimationFrame(frame);
  if (autoRecord) startLiveRecording();

  // Exposed for the debug overlay and for smoke-testing internals.
  // `rafHandle` is a live getter (not a snapshot) so smoke tests can
  // precisely confirm stopTimeline() cancels the CURRENT pending frame
  // (rather than inferring it from run rates, which headless Chromium's
  // rAF throttling and AudioContext clock drift make unreliable to assert on).
  window.__SMW = {
    conductor, paramBus, sim, audioEngine, visionLoop, debugOverlay, synth, fontLibrary, sf2Engine, fontRecommender,
    renderer, rendererMode, rendererBackend: renderer?.backend || 'canvas',
    customBiome: timelineData.customBiome || null,
    analysis: timelineData.analysis || null,
    stems: timelineData.stems || null,
    muteTimelineSynth,
    tracks: timelineData.tracks || [], pairs: timelineData.pairs || [],
    get rafHandle() { return rafHandle; },
  };
}

/** Every ordinary play is recorded by default, at whatever the export row
 *  is set to (1440p/60fps out of the box) -- so there's always something
 *  to save at the end without the player having to think ahead and hit
 *  Export before starting. Small corner indicator only; the big center HUD
 *  stays reserved for a deliberate re-export. */
function startLiveRecording() {
  const preset = Number(exportResEl?.value) || 1440;
  const fps = Number(exportFpsEl?.value) || 60;
  const { w, h } = exportDims(preset);
  videoExporter = new VideoExporter({ audioEngine, sourceCanvas: canvas });
  videoExporter.start({ width: w, height: h, fps });
  exporting = true;
  recordingMode = 'live';
  liveRecHudEl?.classList.remove('hidden');
}

async function loadMidiFile(file) {
  try {
    await bootAudio();
    const gen = ++loadGen;
    const buf = await file.arrayBuffer();
    if (!buf || buf.byteLength < 14) {
      throw new Error('File is empty or too small to be a MIDI file');
    }
    const data = midiToTimeline(buf);
    if (!data.timeline || data.timeline.length === 0) {
      throw new Error('MIDI parsed but contains no notes');
    }
    lastSongName = file.name || 'song';
    data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
    // Custom biome generation lives inside the load path so every drop/upload
    // of a .mid produces a unique world without changing stock demo casting.
    data.customBiome = generateCustomBiomeFromMidi(data, file.name || 'MIDI');
    rememberCustomBiome(paramBus, data.customBiome);
    // Ratings gate the start (no more mid-song audition lag): the percussion
    // loading show entertains while every font auditions against THIS midi.
    muteTimelineSynth = false;
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
  return loadAudioFiles([file]);
}

/** Sums N decoded stems into one stereo mix buffer -- the mix is both the
 *  analysis subject and what actually plays. Stems shorter than the longest
 *  simply end early (silence-padded by construction). */
function sumToMixBuffer(buffers) {
  const rate = buffers[0].sampleRate;
  const length = Math.max(...buffers.map((b) => b.length));
  const mix = audioEngine.ctx.createBuffer(2, length, rate);
  // Peak is tracked during the LAST stem's accumulation (sum order doesn't
  // change the result, so the longest stem goes last -- it spans the whole
  // mix, making every out[i] final under it), sparing a separate full scan.
  const ordered = [...buffers].sort((a, b) => a.length - b.length);
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const out = mix.getChannelData(c);
    for (let bi = 0; bi < ordered.length; bi++) {
      const src = ordered[bi].getChannelData(Math.min(c, ordered[bi].numberOfChannels - 1));
      const last = bi === ordered.length - 1;
      for (let i = 0; i < src.length; i++) {
        out[i] += src[i];
        if (last) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
      }
    }
  }
  // Normalize only if the sum actually clips -- quiet stems stay quiet.
  if (peak > 1) {
    const g = 0.98 / peak;
    for (let c = 0; c < 2; c++) {
      const ch = mix.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] *= g;
    }
  }
  return mix;
}

const LYRICS_AUTO_SKIP_MS = 15000;

/** Downmixes a decoded AudioBuffer to one mono Float32Array (plain average
 *  of its channels) -- StemAlign.vocalActivity only wants a single channel
 *  and doesn't know or care about the browser AudioBuffer type. */
function monoChannel(buffer) {
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return ch0;
  const out = new Float32Array(ch0.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/** LyricsClient's `{synced, plain, instrumental}` result -> LyricStructure's
 *  labeled/emotion-scored blocks -> the lyricSections shape SectionFusion
 *  consumes. Returns null for anything unusable (no match, instrumental
 *  track, or a match with no actual text) -- BiomeManager's fuseSections
 *  already treats a null/absent lyricSections as a strict no-op.
 *
 *  When the lyrics came back plain (no per-line timestamps) AND the drop
 *  included a stem whose filename reads as a true vocal track, this also
 *  tries the StemAlign fallback: syllable-onset detection in that stem,
 *  matched against each block's cumulative syllable count. It's always the
 *  weaker signal (confidence pinned to 0.3) -- kind/valence/intensity still
 *  come from the plain-text label pass; only the timing is borrowed from
 *  the stem. A silent/onset-free stem or any failure in this path simply
 *  falls back to the untimed plain-text labels, exactly as if no stem had
 *  been dropped at all. */
function buildLyricSections(lyricResult, durationMs, vocalStem) {
  if (!lyricResult || lyricResult.instrumental) return null;
  const synced = !!(lyricResult.synced && lyricResult.synced.length);
  const lines = synced ? lyricResult.synced : (lyricResult.plain || []);
  if (lines.length === 0) return null;
  const blocks = toBlocks(lines, { synced });
  if (blocks.length === 0) return null;

  if (!synced && vocalStem) {
    try {
      const mono = monoChannel(vocalStem.buffer);
      const onsets = syllableOnsets(vocalActivity(mono, vocalStem.buffer.sampleRate));
      if (onsets.length > 0) {
        const labeled = labelBlocks(blocks, { durationMs: null }); // plain-text kind/emotion, no timing
        const timed = alignBlocks(blocks, onsets); // stem-derived startMs/endMs only
        return labeled.map((sec, i) => ({
          ...sec,
          startMs: timed[i]?.startMs ?? undefined,
          endMs: timed[i]?.endMs ?? undefined,
          confidence: 0.3,
        }));
      }
    } catch (err) {
      console.warn('[lyrics] stem-aligned syllable fallback failed, using untimed plain labels', err);
    }
  }

  const sections = labelBlocks(blocks, { durationMs });
  return sections.length ? sections : null;
}

/** Shows the identity/lyrics row on the (already-visible) audition panel
 *  and resolves once the player has a verdict: a silent auto-match off the
 *  resolved identity, a manual Find, an explicit Skip, or a 15s auto-skip
 *  so an unattended run never hangs waiting on a human. Always resolves
 *  (never rejects); the resolved value is LyricsClient's raw result or
 *  null ("proceed exactly as before, no lyric data at all"). */
function promptForLyrics(identity, durationSec) {
  return new Promise((resolve) => {
    if (!lyricsRowEl) { resolve(null); return; }
    let settled = false;
    let skipTimer = null;
    const cleanup = () => {
      if (skipTimer) clearTimeout(skipTimer);
      lyricsFindBtnEl?.removeEventListener('click', onFind);
      lyricsSkipBtnEl?.removeEventListener('click', onSkip);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      lyricsRowEl.classList.add('hidden');
      resolve(result);
    };
    const armSkipTimer = () => {
      if (skipTimer) clearTimeout(skipTimer);
      skipTimer = setTimeout(() => finish(null), LYRICS_AUTO_SKIP_MS);
    };
    const runFind = async (artist, title) => {
      if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
      if (lyricsStatusEl) lyricsStatusEl.textContent = 'Searching for lyrics…';
      lyricsFieldsEl?.classList.add('hidden');
      const result = await fetchLyricsCached({ artist, title, album: identity.album, durationSec }, typeof fetch !== 'undefined' ? fetch : null);
      if (settled) return;
      const hasText = result && !result.instrumental && ((result.synced && result.synced.length) || (result.plain && result.plain.length));
      if (hasText) {
        if (lyricsStatusEl) lyricsStatusEl.textContent = `✓ ${result.synced ? 'synced' : 'plain'} lyrics found — ${artist || '?'} — ${title || '?'}`;
        setTimeout(() => finish(result), 700);
      } else {
        if (lyricsStatusEl) lyricsStatusEl.textContent = result?.instrumental ? 'Marked instrumental — no lyrics.' : 'No lyrics found.';
        if (lyricsArtistInputEl) lyricsArtistInputEl.value = artist || '';
        if (lyricsTitleInputEl) lyricsTitleInputEl.value = title || '';
        lyricsFieldsEl?.classList.remove('hidden');
        armSkipTimer();
      }
    };
    const onFind = () => runFind(lyricsArtistInputEl?.value.trim(), lyricsTitleInputEl?.value.trim());
    const onSkip = () => finish(null);
    lyricsFindBtnEl?.addEventListener('click', onFind);
    lyricsSkipBtnEl?.addEventListener('click', onSkip);

    lyricsRowEl.classList.remove('hidden');
    lyricsFieldsEl?.classList.add('hidden');
    if (lyricsArtistInputEl) lyricsArtistInputEl.value = identity.artist || '';
    if (lyricsTitleInputEl) lyricsTitleInputEl.value = identity.title || '';

    if (identity.title) {
      runFind(identity.artist, identity.title);
    } else {
      if (lyricsStatusEl) lyricsStatusEl.textContent = 'Enter the song info to find lyrics (optional).';
      lyricsFieldsEl?.classList.remove('hidden');
      armSkipTimer();
    }
  });
}

/** Best-effort identity + lyrics resolution for a dropped audio file.
 *  Reads ID3 tags straight off `file` (Blob.arrayBuffer() always hands
 *  back a FRESH ArrayBuffer on every call -- unlike an AudioContext-decoded
 *  buffer, it's never detached by decoding happening elsewhere), then runs
 *  the identity/lyrics row on the audition panel already up for separation
 *  progress. Resolves to `{identity, lyricSections}` -- lyricSections is
 *  null whenever there's nothing usable, which every downstream consumer
 *  (SectionFusion, BiomeManager, VibeDirector) already treats as a strict
 *  no-op. Never throws. `vocalStem` ({name, buffer}), when given, is only
 *  ever consulted by buildLyricSections, and only when the lyrics that come
 *  back are plain-only -- see its doc comment for the StemAlign gate. */
async function resolveLyricsForAudio(file, durationSec, vocalStem = null) {
  let identity = { title: null, artist: null, album: null, durationSec, source: 'none', confidence: 0 };
  try {
    const tagBuffer = await file.arrayBuffer();
    identity = resolveIdentity(file.name || '', tagBuffer, durationSec);
  } catch (err) {
    console.warn('[lyrics] identity resolution failed, continuing without it', err);
  }
  try {
    const lyricResult = await promptForLyrics(identity, durationSec);
    const lyricSections = buildLyricSections(lyricResult, Math.round((durationSec || 0) * 1000), vocalStem);
    return { identity, lyricSections };
  } catch (err) {
    console.warn('[lyrics] lyrics resolution failed, continuing without it', err);
    return { identity, lyricSections: null };
  }
}

/** One audio file plays as itself; SEVERAL dropped together are treated as
 *  stems of one song -- summed into a mix for analysis/playback, with each
 *  file's NAME casting its notes to a character (see Casting.js). */
async function loadAudioFiles(files) {
  await bootAudio();
  loadGen++; // raw audio never gates, but a pending gate must not start over us
  const decoded = [];
  for (const file of files) {
    try {
      decoded.push({ name: file.name || 'stem', buffer: await audioEngine.decodeFile(await file.arrayBuffer()) });
    } catch (err) {
      alert(`Could not decode audio file "${file.name}": ` + err.message);
      return;
    }
  }
  const isStemDrop = decoded.length > 1;
  const audioBuffer = isStemDrop ? sumToMixBuffer(decoded.map((d) => d.buffer)) : decoded[0].buffer;

  // A dropped audio file has real work ahead of it (band separation, onset/
  // tempo detection, pitch tracing) with no timeline yet to drive the usual
  // percussion loading show -- so it runs visual-only (star glyph +
  // orbiters + bar, no beat) while staged progress narrates what's
  // happening, instead of leaving the player looking at a bare text line.
  loaderEl.classList.add('hidden');
  hudEl.classList.add('hidden');
  if (auditionHeadingEl) auditionHeadingEl.textContent = 'PULLING THE RECORDING APART';
  auditionPanelEl?.classList.remove('hidden');
  const loadShowSession = loadShow?.start(null);
  loadShow?.setStage(isStemDrop ? `Mixing ${decoded.length} stems…` : 'Separating into 7 frequency bands…', 0);
  // Identity + lyrics resolution runs concurrently with separation/analysis
  // on the same audition panel (a distinct row within it, so the two never
  // fight over the same text) -- the panel stays up until BOTH have
  // settled, so the identity row can't flash and vanish before the player
  // gets a chance to Find/Skip.
  // StemAlign fallback gate (Task E of the lyrics plan): only relevant when
  // several stems were dropped together and one of their filenames reads as
  // an actual vocal track -- buildLyricSections only touches it if the
  // lyrics that come back have no per-line timestamps of their own.
  const vocalStem = isStemDrop ? decoded.find((d) => isVocalStemName(d.name)) : null;
  const lyricsPromise = resolveLyricsForAudio(files[0], audioBuffer.duration, vocalStem);
  let data;
  try {
    data = await audioToTimeline(audioBuffer, {
      userStems: isStemDrop ? decoded : null,
      onProgress: ({ phase, progress }) => {
        if (phase === 'separate') loadShow?.setStage(`Separating into 7 frequency bands… ${Math.round(progress * 100)}%`, progress);
        else if (phase === 'analyze') loadShow?.setStage('Detecting onsets, tempo, and downbeat…', 0.7);
        else if (phase === 'pitch') loadShow?.setStage('Tracing melody, bass, and harmony…', 0.9);
      },
    });
  } finally {
    loadShow?.stop(loadShowSession);
  }
  const { identity: lyricIdentity, lyricSections } = await lyricsPromise;
  data.lyricIdentity = lyricIdentity;
  data.lyricSections = lyricSections;
  if (auditionHeadingEl) auditionHeadingEl.textContent = 'TUNING THE ORCHESTRA';
  auditionPanelEl?.classList.add('hidden');
  lyricsRowEl?.classList.add('hidden');

  if (data.freeTime) {
    console.warn(`Low tempo confidence (${data.confidence.toFixed(2)}) — switching to free-time, kick-reactive jumps.`);
  }
  if (data.stems) {
    console.info('[casting] stems:', data.stems.map((s) => `${s.name} -> ${s.lane || '(world)'}`).join(', '));
  }
  // Audio files get the same per-song visual fingerprint MIDI files do: a
  // unique custom biome from the timeline plus the adapter's chroma/
  // brightness/dynamics/width analysis (see BiomeImporter).
  data.customBiome = generateCustomBiomeFromMidi(data, files[0].name || 'Audio');
  rememberCustomBiome(paramBus, data.customBiome);
  // Raw audio already has every voice baked into the decoded buffer —
  // stacking the synth's pseudo-onset voicing on top is the unwanted
  // synthetic hi-hat/click layer, so the timeline synth stays silent here.
  muteTimelineSynth = true;
  lastSongName = files[0].name || 'song';
  startTimeline(data);
  // Replaying this song (Play again / export) needs the actual decoded
  // audio -- MIDI/demo regenerate their sound from the timeline, but a
  // raw-audio song has none of its own to regenerate.
  lastAudioBuffer = audioBuffer;
  // Raw audio is its own sound source — font fit scores from the previous
  // MIDI would be stale noise here, so drop them.
  fontRecommender?.clear();
  audioEngine.playBuffer(audioBuffer, 0);
}

async function loadDemo() {
  await bootAudio();
  const gen = ++loadGen;
  const data = buildDemoTimeline({});
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  lastSongName = 'demo';
  // The demo is synth-voiced just like a MIDI file, so it gets the same gate.
  muteTimelineSynth = false;
  await startWithAuditionGate(data, gen);
}

function isMidiFile(file) {
  const name = (file.name || '').toLowerCase();
  // Also accept application/midi / audio/midi MIME when the OS omits extension.
  const mime = (file.type || '').toLowerCase();
  return name.endsWith('.mid') || name.endsWith('.midi')
    || mime === 'audio/midi' || mime === 'audio/mid' || mime === 'application/x-midi'
    || mime === 'application/midi';
}

function handleFile(file) {
  if (!file) return;
  handleFiles([file]);
}

/** One file plays as itself. Several AUDIO files dropped together are stems
 *  of one song (their filenames cast the characters); a MIDI in the batch
 *  wins outright since a MIDI is already a complete score. */
function handleFiles(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return;
  const midi = list.find(isMidiFile);
  if (midi) {
    loadMidiFile(midi);
    return;
  }
  loadAudioFiles(list);
}

fileInputEl.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
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
  const files = e.dataTransfer?.files;
  if (files && files.length) handleFiles(files);
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
  if (lastRafMs !== null) {
    const rafDeltaMs = tRaf - lastRafMs;
    // A deliberate re-export replay must not read the extra per-frame
    // export blit as "the game is struggling" and shed phenomena mid-video.
    // The ordinary live play recording alongside a normal playthrough gets
    // no such exemption -- it's real gameplay, and should perform (and
    // shed) exactly as it would unrecorded.
    if (!(exporting && recordingMode === 'replay')) perfGovernor.sample(rafDeltaMs, tRaf);
    fpsEma = emaFps(fpsEma, rafDeltaMs);
    if (fpsHudVisible && fpsHudEl) {
      fpsHudEl.textContent = `${Math.round(fpsEma)} fps  ·  perf ${perfGovernor.level}/${PERF_MAX_LEVEL}`;
    }
  }
  lastRafMs = tRaf;
  const nowMs = audioEngine.nowMs;
  let deltaMs = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (deltaMs < 0) deltaMs = 0;
  if (deltaMs > 250) deltaMs = 250; // clamp huge gaps (tab backgrounded, breakpoint, etc.)
  acc += deltaMs;

  if (zoomKeyDir && sim.zoom) sim.zoom.nudge(zoomKeyDir * KEY_ZOOM_RATE * (deltaMs / 1000));

  let milestoneFiredThisFrame = false;
  while (acc >= STEP_MS) {
    sim.step(STEP_MS, simTime + STEP_MS);
    simTime += STEP_MS;
    acc -= STEP_MS;
    if (sim.performer.milestoneFlash) milestoneFiredThisFrame = true;
  }

  // The Lens: when the world starts adapting back to neutral, a soft
  // transit whoosh -- direction-aware -- marks the moment it takes over.
  if (sfx && sim.zoom && sim.zoom.adaptJustStarted) sfx.transit?.(sim.zoom.adaptDir);

  const alpha = acc / STEP_MS;
  renderer.draw(sim, alpha);
  if (exporting && videoExporter) {
    videoExporter.captureFrame();
    if (recordingTimeEl) {
      const total = conductor.durationMs || 0;
      recordingTimeEl.textContent = `${formatClock(nowMs)} / ${formatClock(total)}`;
    }
  }
  comboReadoutEl.textContent = `×${sim.comboSystem.displayM.toFixed(1)}`;
  if (scoreReadoutEl) scoreReadoutEl.textContent = sim.scoreKeeper.score.toLocaleString('en-US');
  if (milestoneFiredThisFrame) {
    comboReadoutEl.classList.remove('milestone-pulse');
    void comboReadoutEl.offsetWidth; // restart the CSS animation even if it's still mid-flight
    comboReadoutEl.classList.add('milestone-pulse');
  }

  visionLoop.maybeSample(tRaf, simTime);
  debugOverlay.render();

  // Fallback completion: the normal path is FractureEngine's freeze+shatter
  // sequence (see sim.fracture.isDone below), but its idle->about-to-freeze
  // transition only fires inside Renderer.draw, so a stall there (or any
  // other gap) would otherwise leave the engine running forever. 2500ms is
  // comfortably past the freeze lead (300ms) + shatter (600ms).
  const durationMs = conductor.durationMs || 0;
  if (durationMs > 0 && nowMs > durationMs + 2500 && !sim.fracture.isDone) {
    onSongComplete();
    return;
  }
  if (sim.fracture.isDone) {
    onSongComplete();
    return;
  }

  rafHandle = requestAnimationFrame(frame);
}

function formatClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// --- The Lens: zoom controls ---------------------------------------------
// Wheel and held arrow keys nudge the zoom TARGET continuously; Space/click
// snap it fully in or out. Nothing here touches the sim's judgment/jump
// machinery -- ZoomDirector eases the actual value on its own slow clock
// (see ZoomDirector.js), so every one of these inputs feels immediate to
// register but deliberately slow to arrive.
const WHEEL_ZOOM_RATE = 0.0016; // zoom units per wheel-delta-px
const KEY_ZOOM_RATE = 1.1;      // zoom units per second while an arrow key is held
const PINCH_ZOOM_RATE = 0.006;  // zoom units per px of two-finger spread/pinch
const TAP_MOVE_GUARD_PX = 8;    // more movement than this before pointerup -> not a tap-toggle
let zoomKeyDir = 0; // -1 (ArrowDown, zooming out) | 0 | 1 (ArrowUp, zooming in)

function anyModalOpen() {
  return (fontModalEl && !fontModalEl.classList.contains('hidden'))
    || (filmstripModalEl && !filmstripModalEl.classList.contains('hidden'));
}

canvas.addEventListener('wheel', (e) => {
  if (!running || !sim || !sim.zoom || anyModalOpen()) return;
  e.preventDefault();
  sim.zoom.nudge(-e.deltaY * WHEEL_ZOOM_RATE);
}, { passive: false });

// Pinch to zoom: tracks every active pointer by id. With exactly two down,
// the frame-to-frame change in their distance nudges the zoom target
// (spreading = in, pinching = out); a single pointer instead toggles
// fully in/out on release, guarded so a pinch's own down/up never fires a
// spurious toggle.
const activePointers = new Map(); // pointerId -> {x, y}
let pinchPrevDist = null;
let pinchOccurred = false;
let tapStart = null;

function pointerDistance() {
  const pts = [...activePointers.values()];
  if (pts.length < 2) return null;
  return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    pinchPrevDist = pointerDistance();
    pinchOccurred = true;
  } else if (activePointers.size === 1) {
    tapStart = { x: e.clientX, y: e.clientY };
    pinchOccurred = false;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!running || !sim || !sim.zoom || anyModalOpen()) return;
  if (activePointers.size === 2) {
    const dist = pointerDistance();
    if (pinchPrevDist != null && dist != null) {
      sim.zoom.nudge(pinchZoomDelta(pinchPrevDist, dist, PINCH_ZOOM_RATE));
    }
    pinchPrevDist = dist;
  }
});

function endPointer(e) {
  const wasSingle = activePointers.size === 1 && activePointers.has(e.pointerId);
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinchPrevDist = null;
  if (wasSingle && !pinchOccurred && tapStart && running && sim && sim.zoom && !anyModalOpen()) {
    const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
    if (moved < TAP_MOVE_GUARD_PX) sim.zoom.toggle();
  }
  if (activePointers.size === 0) { pinchOccurred = false; tapStart = null; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (anyModalOpen()) return;
    e.preventDefault(); // stops page scroll, and Space "clicking" a focused button
    if (e.repeat || !running || !sim || !sim.zoom) return;
    sim.zoom.toggle();
    return;
  }
  if (e.code === 'ArrowUp') { zoomKeyDir = 1; e.preventDefault(); }
  else if (e.code === 'ArrowDown') { zoomKeyDir = -1; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp' && zoomKeyDir === 1) zoomKeyDir = 0;
  else if (e.code === 'ArrowDown' && zoomKeyDir === -1) zoomKeyDir = 0;
});
window.addEventListener('blur', () => { zoomKeyDir = 0; });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (fontModalEl && !fontModalEl.classList.contains('hidden')) closeFontModal();
    if (filmstripModalEl && !filmstripModalEl.classList.contains('hidden')) closeFilmstripModal();
    return;
  }
  if (e.key === 'f' || e.key === 'F') { openFontModal('list'); return; }
  if (e.key === 'r' || e.key === 'R') { toggleReducedFlash(); return; }
  if (e.key === 'p' || e.key === 'P') {
    fpsHudVisible = !fpsHudVisible;
    fpsHudEl?.classList.toggle('hidden', !fpsHudVisible);
    return;
  }
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
  zoomKeyDir = 0;
  hudEl.classList.add('hidden');
  // Unlike stopTimeline() (a fresh-song teardown), natural completion never
  // used to silence anything -- the decoded audio buffer (or any still-
  // ringing SF2 voices) kept sounding right under the COMPLETE panel.
  audioEngine?.pause();
  synth?.stopAll?.();
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
  if (exporting && recordingMode === 'replay') finishExport();
  else if (exporting && recordingMode === 'live') finishLiveRecording();
}

/** Clean in-memory restart of the last-loaded song (MIDI/demo replay from
 *  their timeline; raw audio replays the actual decoded buffer) -- the sim
 *  is fully seeded and autoplay-driven, so this reproduces the same
 *  performance without a page reload. Falls back to reload if nothing was
 *  retained (e.g. a very first, still-loading session). */
function replaySong({ autoRecord = true } = {}) {
  if (!lastTimelineData) { window.location.reload(); return; }
  startTimeline(lastTimelineData, { autoRecord });
  if (lastAudioBuffer) audioEngine.playBuffer(lastAudioBuffer, 0);
}

async function finishExport() {
  exporting = false;
  recordingMode = null;
  recordingHudEl?.classList.add('hidden');
  if (fpsHudEl) fpsHudEl.classList.toggle('hidden', !fpsHudVisible);
  if (!videoExporter) return;
  const blob = await videoExporter.stop();
  if (!blob || !exportDownloadEl) return;
  if (exportDownloadEl.dataset.url) URL.revokeObjectURL(exportDownloadEl.dataset.url);
  const url = URL.createObjectURL(blob);
  exportDownloadEl.dataset.url = url;
  exportDownloadEl.href = url;
  const preset = Number(exportResEl?.value) || 1080;
  const fps = Number(exportFpsEl?.value) || 60;
  exportDownloadEl.download = exportFilename(lastSongName, preset, fps, videoExporter.mime);
  exportDownloadEl.classList.remove('hidden');
  exportDownloadEl.click();
}

/** The ordinary play's recording, finished: unlike finishExport() this
 *  does NOT auto-download -- it stashes the blob and offers a "Save video"
 *  button on the complete panel, since the player didn't explicitly ask
 *  for this one the way they would an export. */
async function finishLiveRecording() {
  exporting = false;
  recordingMode = null;
  liveRecHudEl?.classList.add('hidden');
  if (!videoExporter) return;
  const preset = Number(exportResEl?.value) || 1440;
  const fps = Number(exportFpsEl?.value) || 60;
  const { w, h } = exportDims(preset);
  const mime = videoExporter.mime;
  const blob = await videoExporter.stop();
  if (!blob || !saveVideoBtnEl) return;
  if (pendingSaveUrl) URL.revokeObjectURL(pendingSaveUrl);
  pendingSaveUrl = URL.createObjectURL(blob);
  pendingSaveLabel = exportFilename(lastSongName, preset, fps, mime);
  saveVideoBtnEl.textContent = `Save video (${w}×${h} · ${fps}fps)`;
  saveVideoBtnEl.classList.remove('hidden');
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

playAgainBtnEl.addEventListener('click', () => replaySong());

saveVideoBtnEl?.addEventListener('click', () => {
  if (!pendingSaveUrl) return;
  const a = document.createElement('a');
  a.href = pendingSaveUrl;
  a.download = pendingSaveLabel || 'super-midio-world.webm';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

exportBtnEl?.addEventListener('click', () => {
  if (exporting || !lastTimelineData) return;
  const preset = Number(exportResEl?.value) || 1080;
  const fps = Number(exportFpsEl?.value) || 30;
  const { w, h } = exportDims(preset);
  completePanelEl.classList.add('hidden');
  exportDownloadEl?.classList.add('hidden');
  recordingHudEl?.classList.remove('hidden');
  fpsHudEl?.classList.add('hidden'); // the recording itself is the readout that matters here
  replaySong({ autoRecord: false }); // this replay gets its OWN explicit exporter below, not the ordinary live one
  videoExporter = new VideoExporter({ audioEngine, sourceCanvas: canvas });
  videoExporter.start({ width: w, height: h, fps });
  exporting = true;
  recordingMode = 'replay';
});

recordingCancelBtnEl?.addEventListener('click', () => {
  videoExporter?.abort();
  exporting = false;
  recordingMode = null;
  recordingHudEl?.classList.add('hidden');
  if (fpsHudEl) fpsHudEl.classList.toggle('hidden', !fpsHudVisible);
  stopTimeline();
  completePanelEl.classList.remove('hidden');
});
