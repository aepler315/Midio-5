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
import { Sf2Synth } from './audio/Sf2Synth.js';
import { SoundfontLibrary, SynthRouter } from './audio/SoundfontLibrary.js';
import { FontRecommender } from './audio/FontRecommender.js';
import { VisionLoop } from './vision/VisionLoop.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { RecalibrationOverlay } from './ui/RecalibrationOverlay.js';
import { DrawErrorLog } from './render/DrawErrorLog.js';
import { ROLE_LOW, ROLE_HIGH, GrooveFingerprint } from './sim/GrooveFingerprint.js';
import { generateCustomBiomeFromMidi, rememberCustomBiome } from './world/BiomeImporter.js';
import {
  getReducedFlash, setReducedFlash, getLyricsDisabled, setLyricsDisabled,
  getBluetoothLatency, setBluetoothLatency, getStoredGroove, setStoredGroove,
} from './ui/Accessibility.js';
import { getVisualStyle, resolveVisualStyle } from './render/VisualStyle.js';
import { PerfGovernor, resolvePerfStartLevel, MAX_LEVEL as PERF_MAX_LEVEL } from './render/PerfGovernor.js';
import { emaFps, resolveFpsHudVisible } from './render/FpsMeter.js';
import { LoadingShow } from './ui/LoadingShow.js';
import { TitleBackdrop } from './ui/TitleBackdrop.js';
import { cssVarMap } from './render/spectral.js';
import { resolveDurationMs } from './core/SongDuration.js';
import { formatSeed, parseSeed } from './utils/seed.js';
import { resolveIdentity } from './lyrics/SongIdentity.js';
import { fetchLyricsCached } from './lyrics/LyricsClient.js';
import { toBlocks, labelBlocks } from './lyrics/LyricStructure.js';
import { isVocalStemName, vocalActivity, syllableOnsets, alignBlocks } from './lyrics/StemAlign.js';
import {
  getJamendoClientId, setJamendoClientId, searchTracks as jamendoSearchTracks,
  fetchTrackAsFile as jamendoFetchTrackAsFile, JamendoError,
} from './net/JamendoSource.js';
import { visualNow } from './core/ChoreoClock.js';
import { SoulseekSearch } from './soulseek/SoulseekSearch.js';


const STEP_MS = 1000 / 120;

const canvas = document.getElementById('stage');
const loaderEl = document.getElementById('loader');
const dropzoneEl = document.getElementById('dropzone');
const fileInputEl = document.getElementById('fileInput');
const demoBtnEl = document.getElementById('demoBtn');
const progressEl = document.getElementById('progressText');
const hudEl = document.getElementById('hud');
const hudRightEl = document.getElementById('hudRight');
const completePanelEl = document.getElementById('completePanel');
const completeSongNameEl = document.getElementById('completeSongName');
const completeSeedEl = document.getElementById('completeSeed');
const copySeedBtnEl = document.getElementById('copySeedBtn');
const resultsGridEl = document.getElementById('resultsGrid');
const playAgainBtnEl = document.getElementById('playAgainBtn');
const replaySameSeedBtnEl = document.getElementById('replaySameSeedBtn');
const replayNewSeedBtnEl = document.getElementById('replayNewSeedBtn');
const completeNewSeedRowEl = document.getElementById('completeNewSeedRow');
const completeNewSeedInputEl = document.getElementById('completeNewSeedInput');
const completeNewSeedStartBtnEl = document.getElementById('completeNewSeedStartBtn');
const completeNewSeedCancelBtnEl = document.getElementById('completeNewSeedCancelBtn');
const seedInputEl = document.getElementById('seedInput');
const seedRandomBtnEl = document.getElementById('seedRandomBtn');
const stageResEl = document.getElementById('stageRes');
const debugOverlayEl = document.getElementById('debugOverlay');
const fpsHudEl = document.getElementById('fpsHud');
const sfFileInputEl = document.getElementById('sfFileInput');
const sfDirInputEl = document.getElementById('sfDirInput');
const sfDirBtnEl = document.getElementById('sfDirBtn');
const settingsBtnEl = document.getElementById('settingsBtn');
const pauseBtnEl = document.getElementById('pauseBtn');
const stopBtnEl = document.getElementById('stopBtn');
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
const lyricsNoneBtnEl = document.getElementById('lyricsNoneBtn');
const noLyricsBtnEl = document.getElementById('noLyricsBtn');
const reducedFlashBtnEl = document.getElementById('reducedFlashBtn');
const btLatencyBtnEl = document.getElementById('btLatencyBtn');
const btLatencyHudBtnEl = document.getElementById('btLatencyHudBtn');
const recalibration = new RecalibrationOverlay({
  panel: document.getElementById('recalPanel'),
  number: document.getElementById('recalNumber'),
  instruction: document.getElementById('recalInstruction'),
  pips: document.getElementById('recalPips'),
  confFill: document.getElementById('recalConfFill'),
  status: document.getElementById('recalStatus'),
});
// Cross-song groove profile (GrooveFingerprint), rehydrated once at startup
// and handed to every Simulation built afterwards.
const groove = new GrooveFingerprint(getStoredGroove());
// Frame-loop failures, counted and shown rather than swallowed.
const drawErrors = new DrawErrorLog();
let grooveSaveDue = false;
let grooveSaveAtMs = 0;
const GROOVE_SAVE_DEBOUNCE_MS = 2000; // wall-clock auto-dismiss for the nudge

const conductor = new Conductor();
const paramBus = new ParamBus();
let audioEngine = null;
let synth = null;
let sim = null;
let renderer = null;
let titleBackdrop = null; // living title-screen backdrop (drawn while !running)
let titleRafHandle = null;
let lastSpecSig = null; // cache-gate for the One-Spectrum CSS var sync (write only on key/form change)
let visionLoop = null;
let debugOverlay = null;
let perfGovernor = null;
let lastRafMs = null; // separate from lastNowMs (audio clock) -- tracks real rAF-to-rAF cadence for the perf governor
let sf2Engine = null;
let fontLibrary = null;
let fontRecommender = null;
let rafHandle = null; // tracks the pending frame() call so a mid-song file
                       // drop can cancel the old loop instead of stacking a
                       // second one alongside it
let fontModalView = 'list'; // 'list' (visible fonts, click-to-hide) | 'hidden' (hidden fonts, click-to-unhide)
let reducedFlash = getReducedFlash(); // The Reel (Movement VI): persisted accessibility toggle
let lyricsDisabled = getLyricsDisabled(); // "No lyrics": persisted opt-out from the lyric fetch/prompt
let bluetoothLatency = getBluetoothLatency(); // floor output-latency for BT headphones
// Graphics presentation: URL ?style=classic|rendered overrides storage.
const _styleParam = new URLSearchParams(location.search).get('style');
let visualStyle = _styleParam ? resolveVisualStyle(_styleParam) : getVisualStyle();
paramBus.visualStyle = visualStyle;

/** Reflect the "No lyrics" preference on the loader toggle button. */
function syncNoLyricsBtn() {
  if (!noLyricsBtnEl) return;
  noLyricsBtnEl.setAttribute('aria-pressed', lyricsDisabled ? 'true' : 'false');
  noLyricsBtnEl.textContent = `No lyrics: ${lyricsDisabled ? 'on' : 'off'}`;
}
syncNoLyricsBtn();
if (noLyricsBtnEl) {
  noLyricsBtnEl.addEventListener('click', () => {
    lyricsDisabled = !lyricsDisabled;
    setLyricsDisabled(lyricsDisabled);
    syncNoLyricsBtn();
  });
}

/** Reflect the reduced-flash accessibility preference on the loader toggle
 *  button -- previously reachable only via the R key, so unusable on touch
 *  and undiscoverable for anyone who doesn't already know the shortcut. */
function syncReducedFlashBtn() {
  if (!reducedFlashBtnEl) return;
  reducedFlashBtnEl.setAttribute('aria-pressed', reducedFlash ? 'true' : 'false');
  reducedFlashBtnEl.textContent = `Reduced flash: ${reducedFlash ? 'on' : 'off'}`;
}
syncReducedFlashBtn();
if (reducedFlashBtnEl) reducedFlashBtnEl.addEventListener('click', () => toggleReducedFlash());

/** Reflect Bluetooth latency mode on loader + in-game HUD buttons and the AudioEngine. */
function syncBtLatencyUi() {
  const on = bluetoothLatency;
  if (btLatencyBtnEl) {
    btLatencyBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    btLatencyBtnEl.textContent = `BT latency: ${on ? 'on' : 'off'}`;
  }
  if (btLatencyHudBtnEl) {
    btLatencyHudBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    btLatencyHudBtnEl.textContent = on ? 'BT lag on' : 'BT lag';
    btLatencyHudBtnEl.title = on
      ? 'Bluetooth latency mode on (~200 ms floor). Click to turn off.'
      : 'Bluetooth latency mode (~200 ms floor for headphones). Remembered.';
  }
  if (audioEngine) audioEngine.bluetoothLatencyMode = on;
}
function toggleBluetoothLatency() {
  bluetoothLatency = !bluetoothLatency;
  setBluetoothLatency(bluetoothLatency);
  syncBtLatencyUi();
}
syncBtLatencyUi();
if (btLatencyBtnEl) btLatencyBtnEl.addEventListener('click', toggleBluetoothLatency);
if (btLatencyHudBtnEl) btLatencyHudBtnEl.addEventListener('click', toggleBluetoothLatency);
// Set per load path (true only for raw decoded audio, which already has
// every voice baked into the buffer) and read by applySynthMutePolicy().
let muteTimelineSynth = false;
let loadShow = null; // percussion loading show, created in bootAudio
let loadGen = 0;     // a newer load cancels a stale audition gate's start

// Retained so "Replay seed" can restart the same song without a page reload
// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on
// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).
let lastTimelineData = null;
let lastAudioBuffer = null;
let lastSongName = 'song';
let lastSongSeed = null; // 32-bit seed used for the run that just finished

// Stage: logical composition is always 1280×720; backing store scales up to
// the chosen preset (720 / 1080 / 1440 / 4K) for sharper output.
const STAGE_W = 1280;
const STAGE_H = 720;
const STAGE_PRESETS = {
  720: { w: 1280, h: 720 },
  1080: { w: 1920, h: 1080 },
  1440: { w: 2560, h: 1440 },
  2160: { w: 3840, h: 2160 },
};
const STAGE_RES_KEY = 'smw:stageRes';

let simTime = 0;
let acc = 0;
let lastNowMs = 0;
let running = false;
let paused = false; // suspends the AudioContext itself -- the master clock everything derives from
let fpsHudVisible = resolveFpsHudVisible(typeof location !== 'undefined' ? location.search : '');
let fpsEma = null;
fpsHudEl?.classList.toggle('hidden', !fpsHudVisible);
// Renderer path: ?renderer=webgl enables the optional WebGL post-FX overlay.
// Default remains pure Canvas 2D so drag/upload MIDI never depends on GL.
const rendererMode = resolveRendererMode(
  typeof location !== 'undefined' ? location.search : '',
);
paramBus.rendererMode = rendererMode;

// The title screen is alive from the very first frame: a living backdrop
// (starfield + nebula + the trio) runs on its own rAF loop until a song
// starts, so the loader is never a dead gradient.
startTitleBackdrop();

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

function readStagePreset() {
  const fromUi = Number(stageResEl?.value);
  if (STAGE_PRESETS[fromUi]) return fromUi;
  try {
    const stored = Number(localStorage.getItem(STAGE_RES_KEY));
    if (STAGE_PRESETS[stored]) return stored;
  } catch { /* no storage */ }
  return 1440; // house default: 1440p (display targets 60fps via rAF)
}

function persistStagePreset(preset) {
  try { localStorage.setItem(STAGE_RES_KEY, String(preset)); } catch { /* no storage */ }
}

/** Backing-store size for the chosen preset (up to 4K). Sim stays logical 1280×720. */
function fitCanvas() {
  const preset = readStagePreset();
  const dims = STAGE_PRESETS[preset] || STAGE_PRESETS[1440];
  if (canvas.width !== dims.w || canvas.height !== dims.h) {
    canvas.width = dims.w;
    canvas.height = dims.h;
  }
}

function readPinnedSeed() {
  return parseSeed(seedInputEl?.value);
}

function setSeedInput(seed) {
  if (!seedInputEl) return;
  seedInputEl.value = seed == null ? '' : formatSeed(seed);
}

function randomizeSeed() {
  const s = (Math.random() * 0x100000000) >>> 0;
  setSeedInput(s);
  return s;
}

// URL ?seed= and stored stage res on boot.
{
  try {
    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const qSeed = parseSeed(params.get('seed'));
    if (qSeed != null) setSeedInput(qSeed);
  } catch { /* ignore */ }
  if (stageResEl) {
    stageResEl.value = String(readStagePreset());
    stageResEl.addEventListener('change', () => {
      persistStagePreset(Number(stageResEl.value) || 1440);
      if (!running) fitCanvas();
    });
  }
  seedRandomBtnEl?.addEventListener('click', () => randomizeSeed());
  fitCanvas();
}

async function bootAudio() {
  if (audioEngine) return;
  audioEngine = new AudioEngine();
  audioEngine.bluetoothLatencyMode = bluetoothLatency;
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
  // Auditions every font against each loaded MIDI and steers the library to
  // the best fit (see FontRecommender.js). Fonts dropped in mid-song get
  // auditioned against the current song as they land.
  fontRecommender = new FontRecommender(fontLibrary, { onUpdate: () => renderFontModal() });
  fontLibrary.onAdded = (font) => fontRecommender.auditionFont(font);
  // Best-effort background load — never blocks song start (§ soundfonts/README.md).
  fontLibrary.autoLoadFromServer('./soundfonts/');
  loadShow = new LoadingShow({
    canvasEl: auditionCanvasEl, textEl: auditionTextEl, barFillEl: auditionBarFillEl,
    audioEngine,
  });
}

/** MIDI/demo loads start immediately -- no more waiting on a loading
 *  screen for font ratings to land. FontRecommender still auditions every
 *  loaded font against this song in the background and steers the library
 *  to the best fit as verdicts arrive, same as fonts dropped mid-song. */
function startImmediately(data) {
  startTimeline(data);
  fontRecommender?.auditionForTimeline(data);
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
if (pauseBtnEl) pauseBtnEl.addEventListener('click', () => togglePause());
if (stopBtnEl) stopBtnEl.addEventListener('click', () => backToTitle());
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
  renderFontModal();
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
  // conductor is a single instance shared across every song (see its
  // construction above); Simulation and its subsystems subscribe to it at
  // construction and never unsubscribe on their own. Without this, a replay
  // leaves the old sim's listeners registered forever -- each stacking on
  // top of the next, still firing into torn-down state on every future
  // dispatch for the rest of the session.
  if (sim) { sim.dispose(); sim = null; }
  // A stop/restart must never leave the AudioContext suspended -- its
  // currentTime is the master clock every song's timing derives from
  // (see AudioEngine.js header), and a still-suspended context would
  // freeze the NEXT song before it even starts.
  if (paused) {
    paused = false;
    audioEngine?.ctx?.resume();
    updatePauseButtonUI();
  }
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  audioEngine?.pause();
  // Forget any decoded buffer from a previous raw-audio song -- otherwise a
  // MIDI/demo load right after one leaves the OLD song's buffer attached,
  // and the mountain seekbar would start playing it on top of the new one.
  // A raw-audio load re-attaches its own buffer via playBuffer() afterward.
  audioEngine?.clearBuffer();
  // The log-on-powers-of-two cadence is meant to keep a PERSISTENT failure
  // legible without flooding the console. Carried across songs, it does the
  // opposite: a brand new regression in song 2 inherits song 1's count and
  // can stay silent until occurrence 1024. Each song gets a clean slate.
  drawErrors.reset();
  synth?.stopAll?.();
  // Tear down optional WebGL overlay so a mid-song drop doesn't stack layers.
  if (renderer && typeof renderer.dispose === 'function') {
    try { renderer.dispose(); } catch { /* ignore */ }
  }
  renderer = null;
  completePanelEl.classList.add('hidden');
  completeNewSeedRowEl?.classList.add('hidden');
  debugOverlayEl.classList.add('hidden');
  auditionPanelEl?.classList.add('hidden');
}

function updatePauseButtonUI() {
  if (!pauseBtnEl) return;
  pauseBtnEl.innerHTML = paused ? '&#9654;' : '&#9208;'; // play triangle vs. pause bars
  pauseBtnEl.title = paused ? 'Resume' : 'Pause';
  pauseBtnEl.setAttribute('aria-pressed', paused ? 'true' : 'false');
}

/** Suspends/resumes the AudioContext itself -- since every clock in the
 *  sim (jump timing, note dispatch, ChoreoClock) reads straight off
 *  ctx.currentTime, freezing the context freezes the whole performance
 *  in place with nothing extra to track, and resuming picks up exactly
 *  where it left off. */
function togglePause() {
  if (!running || !sim || !audioEngine) return;
  paused = !paused;
  if (paused) audioEngine.ctx.suspend();
  else { audioEngine.ctx.resume(); lastRafMs = null; }
  updatePauseButtonUI();
}

/** Back to the title/drop screen so a different song can be chosen. */
function backToTitle() {
  stopTimeline();
  completePanelEl.classList.add('hidden');
  hudEl.classList.add('hidden');
  loaderEl.classList.remove('hidden');
  slskPanelSearch?.resetBusy();
  startTitleBackdrop();
}

function startTimeline(timelineData, { songSeed: seedOverride = undefined } = {}) {
  stopTimeline();
  fitCanvas();
  applySynthMutePolicy();
  // Guard a degenerate declared duration (<=0): without it, FractureEngine's
  // idle -> about-to-freeze transition never fires and the song never
  // completes -- the engine would just run forever.
  timelineData.durationMs = resolveDurationMs(timelineData.timeline, timelineData.durationMs);
  lastTimelineData = timelineData;
  // Keep lastAudioBuffer across replays (same song, new/same seed). Loaders
  // that switch song type clear it themselves — wiping it here made
  // "New seed" / "Replay seed" start a silent level after any audio drop.
  conductor.load(timelineData);
  perfGovernor = new PerfGovernor({ startLevel: perfStartLevel });
  // World construction (parallax strips, landmarks) is CPU-heavy; surface a
  // progress line so a multi-second bake never looks like a dead freeze.
  showProgress('Building world…');
  // Seed: explicit override (replay), else pinned UI/URL input, else auto.
  const pinned = seedOverride !== undefined ? seedOverride : readPinnedSeed();
  try {
    sim = new Simulation(conductor, paramBus, {
      bpm: timelineData.bpm || 120,
      energyCurves: timelineData.energyCurves || null,
      // Logical stage always 1280×720 — canvas buffer may be 4K.
      canvasWidth: STAGE_W,
      canvasHeight: STAGE_H,
      customBiome: timelineData.customBiome || null,
      // ChoreoClock: live output-latency getter so beat-anchored envelopes
      // peak when the EAR gets the beat (Bluetooth can lag 200ms+).
      outputLatencyMs: () => audioEngine.outputLatencyMs,
      lyricSections: timelineData.lyricSections || null,
      // SSM structure read (StructureAnalyzer), audio path only. Null on
      // MIDI/demo/free-time, where BiomeManager keeps its own band-energy
      // novelty schedule.
      structure: timelineData.structure || null,
      // The one piece of state that outlives the song: what previous
      // sessions learned about how this player hears a beat.
      groove,
      songSeed: pinned,
      // The conductor track's cue sheet (ConductorTrack.js), when the MIDI
      // carried one. Null for raw audio, the demo, and any MIDI without a
      // track named "Conductor".
      conductorCues: timelineData.conductor || null,
    });
  } catch (err) {
    console.error('[world build failed]', err);
    progressEl.classList.add('hidden');
    loaderEl.classList.remove('hidden');
    alert('Could not build the world: ' + (err?.message || err));
    return;
  }
  lastSongSeed = sim.songSeed;
  setSeedInput(sim.songSeed);
  sim.perf = perfGovernor;
  sim.setReducedFlash(reducedFlash);
  sim.setVisualStyle(visualStyle);
  // Prime one sim step so BiomeManager/update dials (haze, calm, etc.) are
  // initialized before the first paint — a zero-dt first rAF used to draw
  // with undefined multipliers and throw on rgba(...,NaN).
  try { sim.step(STEP_MS, STEP_MS); simTime = STEP_MS; } catch (err) {
    console.warn('[sim prime]', err);
  }
  // Exposed for DebugOverlay only -- resolved song identity has no other
  // consumer in the sim itself (SectionFusion already folded the lyric
  // structure into BiomeManager.sections by this point).
  sim.lyricIdentity = timelineData.lyricIdentity || null;
  // Canvas is always the scene compositor; 'webgl' adds a non-destructive overlay.
  renderer = createRenderer(canvas, rendererMode);
  visionLoop = new VisionLoop(canvas, paramBus, sim, { enabled: false, perfGovernor });
  debugOverlay = new DebugOverlay(debugOverlayEl, sim, paramBus, visionLoop, perfGovernor, drawErrors);
  renderTracks(timelineData.tracks, timelineData.pairs);
  if (filmstripEl) { filmstripEl.innerHTML = ''; filmstripEl.classList.add('hidden'); }

  simTime = 0;
  acc = 0;
  lastNowMs = audioEngine.nowMs;
  lastRafMs = null;
  // Fresh song, fresh button: the demo/play buttons must lose focus so a
  // stray keypress never re-"clicks" them.
  document.activeElement?.blur?.();
  audioEngine.restoreLevel?.(0.85);
  audioEngine.start(0);
  running = true;
  stopTitleBackdrop();

  progressEl.classList.add('hidden');
  loaderEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  wakeHud();
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
    analysis: timelineData.analysis || null,
    stems: timelineData.stems || null,
    muteTimelineSynth,
    songSeed: sim.songSeed,
    tracks: timelineData.tracks || [], pairs: timelineData.pairs || [],
    get rafHandle() { return rafHandle; },
  };
}

async function loadMidiFile(file) {
  try {
    await bootAudio();
    const myGen = ++loadGen;
    const buf = await file.arrayBuffer();
    if (!buf || buf.byteLength < 14) {
      throw new Error('File is empty or too small to be a MIDI file');
    }
    const data = midiToTimeline(buf);
    if (!data.timeline || data.timeline.length === 0) {
      throw new Error('MIDI parsed but contains no notes');
    }
    // A second file dropped while this one was still awaiting arrayBuffer()
    // has since bumped loadGen -- that load is the one the player actually
    // wants now, so this stale one must not clobber it by starting anyway.
    if (myGen !== loadGen) return;
    lastSongName = file.name || 'song';
    data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
    // Custom biome generation lives inside the load path so every drop/upload
    // of a .mid produces a unique world without changing stock demo casting.
    data.customBiome = generateCustomBiomeFromMidi(data, file.name || 'MIDI');
    rememberCustomBiome(paramBus, data.customBiome);
    muteTimelineSynth = false;
    lastAudioBuffer = null; // MIDI is synth-driven; drop any prior decoded audio
    startImmediately(data);
  } catch (err) {
    console.error('[MIDI load failed]', err);
    progressEl.classList.add('hidden');
    alert('Could not load MIDI file: ' + (err?.message || err));
  }
}

/**
 * A MIDI and audio file dropped TOGETHER: the recording is what you hear,
 * the score is what you see. This is the authoring path the conductor track
 * (ConductorTrack.js) exists for -- export both from the same Guitar Pro
 * project and the MIDI becomes an exact, hand-authorable description of the
 * visuals for a song the engine would otherwise have to guess at from raw
 * spectra.
 *
 * The two are assumed to share a t=0 origin, which is what exporting them
 * from one project gives you. Nothing here tries to detect or correct an
 * offset: a silently "corrected" sync that guessed wrong would be far worse
 * to author against than one that is always literal.
 *
 * Analysis is skipped entirely (that's the raw-audio path's job) -- the MIDI
 * already states every onset, so energy curves are synthesized from it just
 * as they are for a MIDI-only load. That also makes this path near-instant
 * where a raw-audio drop of the same song takes its separation/pitch pass.
 */
async function loadScoredAudio(midiFile, audioFiles) {
  try {
    await bootAudio();
    const myGen = ++loadGen;
    showProgress('Reading score and recording…');

    const midiBuf = await midiFile.arrayBuffer();
    if (!midiBuf || midiBuf.byteLength < 14) {
      throw new Error('File is empty or too small to be a MIDI file');
    }
    const data = midiToTimeline(midiBuf);
    if (!data.timeline || data.timeline.length === 0) {
      throw new Error('MIDI parsed but contains no notes');
    }

    const decoded = [];
    for (const file of audioFiles) {
      decoded.push({
        name: file.name || 'stem',
        buffer: await audioEngine.decodeFile(await file.arrayBuffer()),
      });
    }
    const audioBuffer = decoded.length > 1
      ? sumToMixBuffer(decoded.map((d) => d.buffer))
      : decoded[0].buffer;

    if (myGen !== loadGen) return; // a newer load started while we decoded

    // Whichever runs longer wins: a recording with a tail past the last
    // notated bar must not be cut off, and cues written past the end of the
    // audio must still get their chance to fire.
    data.durationMs = Math.max(data.durationMs || 0, audioBuffer.duration * 1000);
    data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
    data.customBiome = generateCustomBiomeFromMidi(data, midiFile.name || 'MIDI');
    rememberCustomBiome(paramBus, data.customBiome);

    // The recording carries every voice already -- the timeline synth would
    // double it, exactly as on the raw-audio path.
    muteTimelineSynth = true;
    lastSongName = audioFiles[0].name || midiFile.name || 'song';
    if (data.conductor) {
      console.info(
        `[conductor] ${data.conductor.cues.length} cues from ${data.conductor.names.join(', ')}`
        + ` (${data.conductor.scheduleCues.length} schedule, ${data.conductor.liveCues.length} live)`,
      );
    }
    startTimeline(data);
    lastAudioBuffer = audioBuffer;
    fontRecommender?.clear(); // the recording is its own sound source
    audioEngine.playBuffer(audioBuffer, 0);
  } catch (err) {
    console.error('[scored audio load failed]', err);
    progressEl.classList.add('hidden');
    hudEl.classList.add('hidden');
    loaderEl.classList.remove('hidden');
    alert('Could not load score + audio: ' + (err?.message || err));
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
      lyricsNoneBtnEl?.removeEventListener('click', onNever);
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
    // "No lyrics": skip this song AND remember the choice so future songs
    // skip the fetch entirely (loadAudioFiles reads lyricsDisabled).
    const onNever = () => {
      lyricsDisabled = true;
      setLyricsDisabled(true);
      syncNoLyricsBtn();
      finish(null);
    };
    lyricsFindBtnEl?.addEventListener('click', onFind);
    lyricsSkipBtnEl?.addEventListener('click', onSkip);
    lyricsNoneBtnEl?.addEventListener('click', onNever);

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
  // A second load started while this one is still analysing (another drop,
  // a demo click, a MIDI drop) bumps loadGen -- that's the load the player
  // actually wants now, so this one must bail before it commits rather than
  // clobbering it. Analysis here is the longest of any load path (band
  // separation + onset/tempo/pitch + an awaited lyrics prompt), so it's the
  // one most likely to still be in flight when a second drop lands.
  const myGen = ++loadGen;
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
  // Everything below can throw (analysis, lyric lookups, world build). The
  // MIDI path next door catches and recovers; this one didn't -- a failure
  // here left the loader hidden, the HUD hidden, and the audition panel
  // stuck on screen forever with no alert and no way back but a reload.
  try {
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
    // "No lyrics" preference: skip the whole identity/lyric fetch + prompt.
    // Everything downstream already no-ops on null lyricSections.
    const lyricsPromise = lyricsDisabled
      ? Promise.resolve({ identity: null, lyricSections: null })
      : resolveLyricsForAudio(files[0], audioBuffer.duration, vocalStem);
    let data;
    try {
      data = await audioToTimeline(audioBuffer, {
        userStems: isStemDrop ? decoded : null,
        // Everything previous sessions learned about how this player splits a
        // kick from a hat, applied to a song they've never played.
        groove,
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
    // A newer load has since started -- let it win. Its own flow owns the
    // loader/audition/HUD visibility from here; this stale one touches none
    // of it.
    if (myGen !== loadGen) return;
    data.lyricIdentity = lyricIdentity;
    data.lyricSections = lyricSections;
    if (auditionHeadingEl) auditionHeadingEl.textContent = 'PULLING THE RECORDING APART';
    auditionPanelEl?.classList.add('hidden');
    lyricsRowEl?.classList.add('hidden');

    if (data.freeTime) {
      // A handled mode switch, not a warning -- free-time/kick-reactive
      // jumps are a normal, fully-supported fallback for rubato tracks.
      console.info(`Low tempo confidence (${data.confidence.toFixed(2)}) — switching to free-time, kick-reactive jumps.`);
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
  } catch (err) {
    console.error('[audio load failed]', err);
    auditionPanelEl?.classList.add('hidden');
    lyricsRowEl?.classList.add('hidden');
    hudEl.classList.add('hidden');
    loaderEl.classList.remove('hidden');
    alert('Could not load audio file: ' + (err?.message || err));
  }
}

async function loadDemo() {
  await bootAudio();
  loadGen++;
  const data = buildDemoTimeline({});
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  lastSongName = 'demo';
  muteTimelineSynth = false;
  lastAudioBuffer = null; // demo is synth-driven
  startImmediately(data);
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
 *  of one song (their filenames cast the characters). A MIDI **and** audio
 *  dropped together is the scored path: the recording plays, the score
 *  drives the visuals (see loadScoredAudio). A MIDI alone is a complete
 *  score and performs itself. */
function handleFiles(files) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return;
  const midi = list.find(isMidiFile);
  const audio = list.filter((f) => !isMidiFile(f));
  if (midi && audio.length) {
    loadScoredAudio(midi, audio);
    return;
  }
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

// Soulseek-powered song search on the title screen (free music by default,
// optional Soulseek via slskd). Results download through the local bridge
// (/api/soulseek/*) and feed the same handleFiles path as drops.
const slskPanelEl = document.getElementById('slskPanel');
let slskPanelSearch = null;
if (slskPanelEl) {
  slskPanelSearch = new SoulseekSearch({
    root: slskPanelEl,
    onFiles: (files) => {
      slskPanelSearch?.resetBusy();
      handleFiles(files);
    },
    onStatus: (msg) => {
      if (msg && progressEl && !progressEl.classList.contains('hidden')) {
        // keep progress text for active loads; search has its own status line
      }
    },
  });
}

// Jamendo search (JamendoSource.js): a legal alternative to dropping a
// local file -- free, Creative-Commons-licensed tracks, fetched and handed
// to the exact same handleFiles() path a local drop uses, so nothing
// downstream needs to know the audio came from the network.
const jamendoClientIdInputEl = document.getElementById('jamendoClientIdInput');
const jamendoSearchInputEl = document.getElementById('jamendoSearchInput');
const jamendoSearchBtnEl = document.getElementById('jamendoSearchBtn');
const jamendoStatusEl = document.getElementById('jamendoStatus');
const jamendoResultsEl = document.getElementById('jamendoResults');

if (jamendoClientIdInputEl) jamendoClientIdInputEl.value = getJamendoClientId();
jamendoClientIdInputEl?.addEventListener('change', () => {
  setJamendoClientId(jamendoClientIdInputEl.value.trim());
});

function setJamendoStatus(text, isError = false) {
  if (!jamendoStatusEl) return;
  jamendoStatusEl.textContent = text || '';
  jamendoStatusEl.classList.toggle('hidden', !text);
  jamendoStatusEl.classList.toggle('jamendoStatusError', !!isError);
}

function formatTrackDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function runJamendoSearch() {
  const q = jamendoSearchInputEl?.value.trim();
  if (!q || !jamendoResultsEl) return;
  jamendoResultsEl.innerHTML = '';
  setJamendoStatus('Searching…');
  let tracks;
  try {
    tracks = await jamendoSearchTracks(q, { clientId: getJamendoClientId() });
  } catch (err) {
    setJamendoStatus(err instanceof JamendoError ? err.message : `Search failed: ${err.message}`, true);
    return;
  }
  if (!tracks.length) { setJamendoStatus('No results.'); return; }
  setJamendoStatus('');
  for (const track of tracks) {
    const li = document.createElement('li');
    li.className = 'jamendoResult';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghostbtn jamendoResultBtn';
    btn.title = track.licenseCcUrl ? `Creative Commons license: ${track.licenseCcUrl}` : '';
    btn.textContent = `${track.name} — ${track.artist} (${formatTrackDuration(track.duration)})`;
    btn.addEventListener('click', () => playJamendoTrack(track, btn));
    li.appendChild(btn);
    jamendoResultsEl.appendChild(li);
  }
}

async function playJamendoTrack(track, btnEl) {
  setJamendoStatus(`Downloading "${track.name}"…`);
  if (btnEl) btnEl.disabled = true;
  try {
    const file = await jamendoFetchTrackAsFile(track);
    setJamendoStatus('');
    handleFiles([file]);
  } catch (err) {
    setJamendoStatus(err instanceof JamendoError ? err.message : `Could not load "${track.name}": ${err.message}`, true);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

jamendoSearchBtnEl?.addEventListener('click', runJamendoSearch);
jamendoSearchInputEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runJamendoSearch(); }
});

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
// #dropzone is role="button" tabindex="0", but browsers don't synthesize a
// click from Enter/Space on a plain div the way they do for a real
// <button> -- without this the game's primary call-to-action isn't
// keyboard-operable at all, and the keypress instead fell through to
// beatTap() (the F/J calibration handler) once the loader is showing.
dropzoneEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  e.preventDefault(); // Space must not also scroll the page
  fileInputEl.click();
});

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
// The settings gear opens straight to the hidden-fonts ("unhide") view; the
// F key (below) opens the visible-fonts list.
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

// --- Track visibility wiring ---
if (trackBadgeBtnEl) trackBadgeBtnEl.addEventListener('click', () => toggleTrackList());

function frame(tRaf) {
  if (!running) return;
  if (paused) { rafHandle = requestAnimationFrame(frame); return; }
  if (lastRafMs !== null) {
    const rafDeltaMs = tRaf - lastRafMs;
    perfGovernor.sample(rafDeltaMs, tRaf);
    fpsEma = emaFps(fpsEma, rafDeltaMs);
    if (fpsHudVisible && fpsHudEl) {
      fpsHudEl.textContent = `${Math.round(fpsEma)} fps  ·  perf ${perfGovernor.level}/${PERF_MAX_LEVEL}`;
    }
  }
  lastRafMs = tRaf;
  hudIdleTick(tRaf);
  const nowMs = audioEngine.nowMs;
  let deltaMs = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (deltaMs < 0) deltaMs = 0;
  if (deltaMs > 250) deltaMs = 250; // clamp huge gaps (tab backgrounded, breakpoint, etc.)
  acc += deltaMs;

  try {
    while (acc >= STEP_MS) {
      sim.step(STEP_MS, simTime + STEP_MS);
      simTime += STEP_MS;
      acc -= STEP_MS;
    }
  } catch (err) {
    // frame() has no wrapper of its own -- an uncaught throw here would abort
    // BEFORE reaching the requestAnimationFrame() call at the bottom, which
    // freezes the entire game loop forever on the last good paint. The prime
    // step at song start already learned this the hard way (see its own
    // try/catch above); this is the same failure mode on every later frame.
    acc = 0; // drop the fractional remainder so a partial step doesn't compound
    if (drawErrors.record(err, tRaf)) {
      console.error(`[sim.step] (occurrence ${drawErrors.worst.count})`, err);
    }
  }

  const alpha = acc / STEP_MS;
  try {
    renderer.draw(sim, alpha);
  } catch (err) {
    // One bad frame must not kill the whole run (canvas NaN colors used to
    // throw here and leave the world frozen on the last good paint). But it
    // must not be invisible either: this catch hid two effects that threw on
    // every invocation for months, silently dropping the rest of each
    // affected frame with them. Counted always, surfaced in the debug
    // readout, and logged on a log2 cadence so a per-frame throw reports its
    // scale instead of burying the console.
    if (drawErrors.record(err, tRaf)) {
      console.error(`[draw] (occurrence ${drawErrors.worst.count})`, err);
    }
  }
  // One Spectrum, the chrome half: sync the HUD CSS custom properties to
  // the live spectral palette. Cache-gated on the quantized shift so the
  // DOM is only touched when the song's key/form actually moves -- never
  // per-frame style thrash.
  if (sim.biomes && typeof sim.biomes.currentHaloColor === 'function') {
    const sig = `${sim.biomes.tonic ?? '?'}|${sim.biomes._spectralShift ? Math.round(sim.biomes._spectralShift() / 3) : 0}|${sim.biomes.currentBlend ? sim.biomes.currentBlend.to : ''}`;
    if (sig !== lastSpecSig) {
      lastSpecSig = sig;
      const halo = sim.biomes.currentHaloColor();
      const tokens = { baseHue: sim.keyDirector ? ((sim.keyDirector.tonic % 12) + 12) % 12 * 30 : 0, halo };
      const vars = cssVarMap(tokens);
      const root = document.documentElement;
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    }
  }

  // Last impact notes → freeze/shatter: fade music out so the glass break
  // lands in silence (not over a long empty pad after the real ending).
  if (sim.fracture?.justEnteredFinale && !sim.fracture.audioSilenced) {
    sim.fracture.audioSilenced = true;
    audioEngine?.fadeToSilence?.(0.32);
    synth?.stopAll?.();
  }

  // Authored cuts: the drop and the apotheosis duck the mix for a beat,
  // the sound half of the same snap the camera/color already get (CutDirector).
  if (sim.cut?.dropJustCut) audioEngine?.duck?.();
  if (sim.cut?.apotheosisJustCut) audioEngine?.duck?.(0.6, 0.04, 0.3);
  // Disaster cuts get the same sound-half treatment as the authored ones
  // above -- a quake strike and a tsunami wall's arrival both duck the mix.
  if (sim.disasters?.justStruck && sim.disasters.struckKind === 'quake') audioEngine?.duck?.(0.7, 0.08, 0.4);
  if (sim.biomes?.tsunamiJustArrived) audioEngine?.duck?.(0.5, 0.05, 0.35);

  // Tap recalibration: drive the count while an (opt-in, 'C'-key-triggered)
  // pass is running. Never blocks the frame, pauses audio, or swallows input.
  if (recalibration.active) {
    const alive = recalibration.update(simTime, {
      beatPeriodMs: sim.jump.beatPeriodMs,
      confidence: sim.beatAnchor.confidence,
    });
    if (!alive) endRecalibration();
  }

  // Debounced profile write: a burst of tapping is one save, not thirty.
  if (grooveSaveDue && tRaf >= grooveSaveAtMs) {
    grooveSaveDue = false;
    grooveSaveAtMs = tRaf + GROOVE_SAVE_DEBOUNCE_MS;
    setStoredGroove(groove);
  }

  visionLoop.maybeSample(tRaf, simTime);
  debugOverlay.render();

  // Fallback completion: FractureEngine finishes after musical last impact +
  // shatter, not after silence-padded duration. Guard still uses declared
  // duration so a stuck freeze never hangs forever.
  const durationMs = conductor.durationMs || 0;
  const musicalEnd = sim.fracture?.finale?.musicalEndMs ?? durationMs;
  if (durationMs > 0 && nowMs > Math.max(durationMs, musicalEnd) + 2500 && !sim.fracture.isDone) {
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

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Build end-of-run stats: measurable song/run facts, no grade or score. */
function buildRunStats(sim) {
  const combo = sim.comboSystem;
  const sk = sim.scoreKeeper;
  const chart = sim.noteChart || {};
  const durationMs = sim.conductor?.durationMs || 0;
  const sections = sim.biomes?.sections?.length || 0;
  const holdsTotal = chart.holdCount || 0;
  const taps = chart.tapCount || 0;
  const jumps = combo.cleanLandings || 0;
  const peakFever = sim.fever ? Math.round((sim.fever.peak || 0) * 100) : 0;
  const peakMult = Math.min(3, combo.peakM || 1);
  const bpm = sim.bpm || 0;

  return [
    { label: 'Duration', value: formatDuration(durationMs) },
    { label: 'Tempo', value: bpm ? `${Math.round(bpm)} BPM` : '—' },
    { label: 'Clean landings', value: String(jumps) },
    { label: 'Peak streak', value: String(sk.peakStreak || 0) },
    { label: 'Peak mult', value: `×${peakMult.toFixed(1)}` },
    { label: 'Peak fever', value: `${peakFever}%` },
    { label: 'Chart jumps', value: String(taps) },
    {
      label: 'Holds ridden',
      value: holdsTotal > 0 ? `${sk.holdsCompleted} / ${holdsTotal}` : '—',
    },
    { label: 'Sections', value: String(sections) },
    {
      label: 'Stage',
      value: `${canvas.width}×${canvas.height}`,
      wide: true,
    },
  ];
}

function renderResultsGrid(stats) {
  if (!resultsGridEl) return;
  resultsGridEl.innerHTML = stats.map((s) => `
    <div class="statCell${s.wide ? ' statWide' : ''}">
      <span class="statLabel">${s.label}</span>
      <span class="statValue">${s.value}</span>
    </div>`).join('');
}

// Pointer is tracked so star-children can notice the user; never moves camera.
// Map client coords through the CSS rect into logical 1280×720 stage space.
function clientToStage(e) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((e.clientX - rect.left) / rect.width) * STAGE_W,
    y: ((e.clientY - rect.top) / rect.height) * STAGE_H,
  };
}

/** The title screen's living backdrop: a slow, seeded starfield + nebula +
 *  the trio's spectral glyphs drifting and breathing, drawn to the stage
 *  canvas while no song is running. Runs on its own rAF loop so the very
 *  first frame a visitor sees is already a Midio world, not a flat
 *  gradient. Cheap (a few gradient fills + mesh strokes) and stops the
 *  instant a song starts. */
function titleFrame(tRaf) {
  if (running) return;
  if (!titleBackdrop) {
    titleBackdrop = new TitleBackdrop({ seed: 1, width: canvas.width, height: canvas.height });
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  titleBackdrop.draw(ctx, tRaf / 1000);
  titleRafHandle = requestAnimationFrame(titleFrame);
}

function startTitleBackdrop() {
  if (titleRafHandle == null) titleRafHandle = requestAnimationFrame(titleFrame);
}

function stopTitleBackdrop() {
  if (titleRafHandle != null) {
    cancelAnimationFrame(titleRafHandle);
    titleRafHandle = null;
  }
}

// Zoom has been removed from the game: there is no player Lens control and
// no automatic camera zoom. The pointer is still tracked, but only so the
// star-children can notice where the user is (they're aware of the user); it
// never moves the camera. Client coords are mapped through the canvas rect
// into the 1280x720 stage space the sim draws in.
canvas.addEventListener('pointermove', (e) => {
  if (!running || !sim || !sim.setPointer) return;
  const p = clientToStage(e);
  if (!p) return;
  sim.setPointer(p.x, p.y);
});

/** Jump audio clock + conductor + sim time to `ms` (mountain seekbar). */
function seekSong(ms) {
  if (!running || !sim || !audioEngine) return;
  const dur = Math.max(1, sim.conductor?.durationMs || audioEngine.nowMs + 1);
  const t = Math.max(0, Math.min(ms, dur - 1));
  synth?.stopAll?.();
  audioEngine.seekToMs(t);
  if (sim.conductor?.seekTo) sim.conductor.seekTo(t);
  // The conductor track's own cursor has to move with the playhead, or a
  // backward scrub would replay the music with every cue behind the new
  // position already spent (see CueDirector.seekTo).
  sim.cues?.seekTo(t);
  simTime = t;
  lastNowMs = t;
  acc = 0;
  if (sim.timeMs != null) sim.timeMs = t;
  // A milestone glyph belongs to the moment that earned it. Scrubbing away
  // leaves it stranded (a backward seek puts the clock before its own start),
  // so drop it and anything queued behind it rather than letting either
  // surface at the wrong point in the song.
  renderer?.epicycles?.reset();
}

/** The player's own sense of "where's the beat" (BeatAnchor.js): stamped on
 *  the clock the EAR is on (visualNow), same discipline as every other
 *  beat-anchored cue in the sim. */
function beatTap(role = null) {
  if (!running || !sim || paused || !audioEngine) return;
  sim.onBeatTap(visualNow(audioEngine.nowMs, audioEngine.outputLatencyMs), role);
  // Persist on a roled tap only. Unroled catch-all taps move the anchor but
  // teach the templates nothing, and writing storage on every stray keypress
  // would be a lot of churn for no new information.
  if (role) grooveSaveDue = true;
}

/** Open the eight-measure tap-recalibration count. Never pauses the song --
 *  taps keep flowing through the canvas handler into BeatAnchor as usual.
 *  Opt-in only (the 'C' key) -- there is no automatic prompt. */
function startRecalibration() {
  if (!running || !sim || paused || recalibration.active) return;
  recalibration.start(simTime, sim.jump.beatPeriodMs, sim.beatAnchor.confidence);
  sim.recalibrating = true;
  sim.syncMonitor.onCalibrated();
}
function endRecalibration() {
  if (!recalibration.active) return;
  const text = recalibration.resultText(sim ? sim.beatAnchor.confidence : 0);
  recalibration.stop();
  if (sim) sim.recalibrating = false;
  console.info('[recalibrate]', text);
}

// HUD auto-fade: the button cluster (#hudRight) fades out after a few
// seconds with no interaction, and comes back awake on the next one. While
// asleep, a tap on the canvas is spent entirely on waking the HUD back up --
// it never also acts as a gameplay tap or a seek/section click, exactly the
// same "tap to unlock" beat a phone screen uses. Buttons themselves can't be
// hit while faded at all (CSS pointer-events:none on .hud-faded), so only
// the canvas path needs an explicit gate.
const HUD_FADE_MS = 3000;
let hudAwake = true;
let hudSleepAtMs = 0;
function wakeHud() {
  hudSleepAtMs = performance.now() + HUD_FADE_MS;
  if (hudAwake) return;
  hudAwake = true;
  hudRightEl?.classList.remove('hud-faded');
}
function hudIdleTick(nowRafMs) {
  if (hudAwake && nowRafMs >= hudSleepAtMs) {
    hudAwake = false;
    hudRightEl?.classList.add('hud-faded');
  }
}
hudRightEl?.addEventListener('pointerdown', wakeHud);

// Mountain seekbar: click to seek; click a section to open its debug detail.
// Anywhere else on the canvas -- not a button, not the seekbar -- resyncs
// the player's beat anchor instead.
// Right-click is the high hand, so the browser's own menu has to stay out of
// the way -- otherwise every high tap on the canvas pops it open.
canvas.addEventListener('contextmenu', (e) => { if (running && sim) e.preventDefault(); });

canvas.addEventListener('pointerdown', (e) => {
  if (!running || !sim) return;
  if (!hudAwake) { wakeHud(); return; }
  wakeHud();
  const p = clientToStage(e);
  if (!p) return;
  const hit = renderer?.composer ? renderer.composer.hitTest(p.x, p.y, { width: STAGE_W, height: STAGE_H }) : null;
  // Mouse buttons mirror the keys: left pairs with F (low), right with J
  // (high). Anything else (middle, back/forward) stays an unroled tap rather
  // than being silently filed as one of the two hands.
  if (!hit) { beatTap(e.button === 2 ? ROLE_HIGH : e.button === 0 ? ROLE_LOW : null); return; }
  e.preventDefault();
  if (hit.type === 'detail') return; // keep overlay open
  if (hit.type === 'strip') {
    // Toggle section detail when re-clicking the same section; always seek.
    if (hit.sectionIndex >= 0) {
      if (renderer.composer.selectedSection === hit.sectionIndex) {
        renderer.composer.selectedSection = -1;
      } else {
        renderer.composer.selectedSection = hit.sectionIndex;
      }
    }
    seekSong(hit.tMs);
  }
});

window.addEventListener('keydown', (e) => {
  if (running) wakeHud();
  if (e.key === 'Escape') {
    if (fontModalEl && !fontModalEl.classList.contains('hidden')) closeFontModal();
    if (filmstripModalEl && !filmstripModalEl.classList.contains('hidden')) closeFilmstripModal();
    // Close section detail overlay on the seekbar.
    if (renderer?.composer && renderer.composer.selectedSection >= 0) {
      renderer.composer.selectedSection = -1;
    }
    return;
  }
  // F3 — toggle how the engine labeled song sections on the mountain seekbar.
  // Selection / detail overlay is independent (click a section; Esc to close).
  if (e.key === 'F3') {
    e.preventDefault();
    if (!sim) return;
    sim.showSectionLabels = !sim.showSectionLabels;
    if (paramBus) paramBus.showSectionLabels = sim.showSectionLabels;
    return;
  }
  // Tap recalibration. Must return before the catch-all beat-tap branch at
  // the bottom, or opening the overlay would also register a stray tap and
  // start the anchor's session on a timestamp the player didn't mean.
  if (e.key === 'c' || e.key === 'C') {
    if (recalibration.active) endRecalibration(); else startRecalibration();
    return;
  }
  // The two calibration hands. Always live -- there is no mode to enter and
  // nothing to open first; the overlay (C) is guidance, not a gate. Both feed
  // the beat anchor exactly as any tap always has, and additionally tell the
  // groove fingerprint WHICH drum the player was answering, which is the part
  // an anonymous timestamp could never carry.
  if (e.key === 'f' || e.key === 'F') { beatTap(ROLE_LOW); return; }
  if (e.key === 'j' || e.key === 'J') { beatTap(ROLE_HIGH); return; }
  // Fonts moved off F to free the left hand for calibration.
  if (e.key === 'g' || e.key === 'G') { openFontModal('list'); return; }
  if (e.key === 'r' || e.key === 'R') { toggleReducedFlash(); return; }

  if (e.key === 'p' || e.key === 'P') {
    fpsHudVisible = !fpsHudVisible;
    fpsHudEl?.classList.toggle('hidden', !fpsHudVisible);
    return;
  }
  if (debugOverlay) {
    if (e.key === '`') { debugOverlay.toggle(); return; }
    if (e.key === 'v' || e.key === 'V') { debugOverlay.toggleVision(); return; }
    if (e.key === 't' || e.key === 'T') { toggleTrackList(); return; }
  }
  // Reserved regardless of whether the debug overlay happens to be up yet.
  if (e.key === '`' || e.key === 'v' || e.key === 'V' || e.key === 't' || e.key === 'T') return;

  // Almost any other key resyncs the player's beat anchor (BeatAnchor.js) --
  // ignore held-key auto-repeat, modifier chords, and typing into a field.
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const activeTag = document.activeElement?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  beatTap();
});

/** The Reel (Movement VI): live-toggle + persist the reduced-flash
 *  accessibility setting, cascading into the running sim if there is one. */
function toggleReducedFlash() {
  reducedFlash = !reducedFlash;
  setReducedFlash(reducedFlash);
  sim?.setReducedFlash(reducedFlash);
  syncReducedFlashBtn();
}

function onSongComplete() {
  running = false;
  hudEl.classList.add('hidden');
  // Silence audio under the complete panel (otherwise the buffer/SF2 keeps going).
  audioEngine?.pause();
  synth?.stopAll?.();

  lastSongSeed = sim.songSeed;
  if (completeSongNameEl) {
    const name = (lastSongName || 'Song').replace(/\.[a-z0-9]+$/i, '');
    completeSongNameEl.textContent = name;
  }
  if (completeSeedEl) completeSeedEl.textContent = formatSeed(sim.songSeed);
  setSeedInput(sim.songSeed);
  renderResultsGrid(buildRunStats(sim));
  renderFilmstrip(sim.highlightReel?.frames || []);
  completePanelEl.classList.remove('hidden');
}

/** Restart the last-loaded song. Pass songSeed to pin the world; omit for
 *  whatever is currently in the seed field (or auto if blank). */
function replaySong({ songSeed } = {}) {
  if (!lastTimelineData) { window.location.reload(); return; }
  // Capture buffer before rebuild — startTimeline stops the AudioContext source
  // via stopTimeline, but must not lose the decoded song for the restart.
  const buffer = lastAudioBuffer;
  startTimeline(lastTimelineData, { songSeed: songSeed !== undefined ? songSeed : readPinnedSeed() });
  if (buffer) {
    lastAudioBuffer = buffer;
    audioEngine.playBuffer(buffer, 0);
  }
  // Seed field + complete readout stay in sync with the run that just started.
  if (sim?.songSeed != null) {
    lastSongSeed = sim.songSeed;
    setSeedInput(sim.songSeed);
    if (completeSeedEl) completeSeedEl.textContent = formatSeed(sim.songSeed);
  }
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

playAgainBtnEl?.addEventListener('click', () => backToTitle());

// Replay seed: exactly the run that just played, nothing else in the mix.
replaySameSeedBtnEl?.addEventListener('click', () => {
  replaySong({ songSeed: lastSongSeed });
});

// New seed: prompt for one inline on the card, then replay with it.
replayNewSeedBtnEl?.addEventListener('click', () => {
  if (!completeNewSeedRowEl || !completeNewSeedInputEl) { replaySong({ songSeed: randomizeSeed() }); return; }
  completeNewSeedInputEl.value = formatSeed((Math.random() * 0x100000000) >>> 0);
  completeNewSeedRowEl.classList.remove('hidden');
  completeNewSeedInputEl.focus();
  completeNewSeedInputEl.select();
});

completeNewSeedCancelBtnEl?.addEventListener('click', () => {
  completeNewSeedRowEl?.classList.add('hidden');
});

completeNewSeedStartBtnEl?.addEventListener('click', () => {
  const parsed = parseSeed(completeNewSeedInputEl?.value);
  const s = parsed != null ? parsed : (Math.random() * 0x100000000) >>> 0;
  completeNewSeedRowEl?.classList.add('hidden');
  replaySong({ songSeed: s });
});

completeNewSeedInputEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); completeNewSeedStartBtnEl?.click(); }
  else if (e.key === 'Escape') { e.preventDefault(); completeNewSeedCancelBtnEl?.click(); }
});

copySeedBtnEl?.addEventListener('click', async () => {
  const text = completeSeedEl?.textContent?.trim() || formatSeed(lastSongSeed || 0);
  try {
    await navigator.clipboard.writeText(text);
    copySeedBtnEl.textContent = 'Copied';
    setTimeout(() => { copySeedBtnEl.textContent = 'Copy'; }, 1200);
  } catch {
    // Fallback: select into the title seed field.
    setSeedInput(parseSeed(text) ?? lastSongSeed);
    seedInputEl?.select?.();
  }
});
