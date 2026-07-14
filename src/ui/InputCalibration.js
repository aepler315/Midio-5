// The pre-game calibration screen and the persistence for the input-latency
// offset. The screen plays a bare metronome and asks for taps in time; the
// median tap bias (robust to one wild tap, see computeCalibrationOffset)
// becomes the stored input offset. It runs once, before the first gameplay
// session ever; after that the in-game LatencyCalibrator keeps the offset
// honest silently, persisting refinements as they land.
import { computeCalibrationOffset } from '../sim/LatencyCalibrator.js';

const OFFSET_KEY = 'smw-input-offset-ms';
const DONE_KEY = 'smw-calibration-done';

export function getStoredInputOffsetMs() {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

export function setStoredInputOffsetMs(v) {
  try { localStorage.setItem(OFFSET_KEY, String(Math.round(v))); } catch { /* private mode */ }
}

export function hasCalibrated() {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}

export function markCalibrated() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
}

export const CALIB_BPM = 100;
export const WARMUP_BEATS = 4;   // listen-only lead-in
export const COUNTED_TAPS = 8;   // taps needed to lock the measurement

/**
 * Runs the calibration screen. The metronome loops until enough taps are
 * collected (or Skip). Resolves with the offset to store, or null on skip.
 * The caller shows/hides panelEl.
 */
export function runCalibrationScreen({ beaconEl, statusEl, skipBtnEl, tapTargetEl, audioEngine }) {
  const ctx = audioEngine.ctx;
  const periodSec = 60 / CALIB_BPM;
  const t0 = ctx.currentTime + 0.6; // beat 0
  let scheduledUpTo = 0; // beat index scheduled so far
  const offsets = [];
  let done = false;

  const click = (t, accent) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accent ? 1320 : 880, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g);
    g.connect(audioEngine.master);
    osc.start(t);
    osc.stop(t + 0.12);
  };

  return new Promise((resolve) => {
    const finish = (value) => {
      if (done) return;
      done = true;
      clearInterval(scheduler);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      tapTargetEl.removeEventListener('pointerdown', onPointer);
      skipBtnEl?.removeEventListener('click', onSkip);
      resolve(value);
    };

    // Chunked lookahead scheduling: the metronome loops until we're done.
    const scheduler = setInterval(() => {
      const horizon = ctx.currentTime + 0.5;
      while (t0 + scheduledUpTo * periodSec < horizon) {
        click(t0 + scheduledUpTo * periodSec, scheduledUpTo % 4 === 0);
        scheduledUpTo++;
      }
    }, 120);

    const onTap = () => {
      if (done) return;
      const nowSec = ctx.currentTime;
      const k = Math.round((nowSec - t0) / periodSec);
      if (k < WARMUP_BEATS) { statusEl.textContent = 'Listen first — taps start counting in a moment…'; return; }
      const offMs = (nowSec - (t0 + k * periodSec)) * 1000;
      if (Math.abs(offMs) > periodSec * 500) return; // between beats: ignore
      offsets.push(offMs);
      const n = Math.min(offsets.length, COUNTED_TAPS);
      statusEl.textContent = `${n}/${COUNTED_TAPS} — ${offMs >= 0 ? '+' : ''}${Math.round(offMs)} ms`;
      if (offsets.length >= COUNTED_TAPS) {
        const offset = computeCalibrationOffset(offsets);
        statusEl.textContent = offset === null || Math.abs(offset) < 5
          ? 'Locked in: your timing is already true.'
          : `Locked in: cancelling ${Math.round(-offset)} ms of latency.`;
        setTimeout(() => finish(offset ?? 0), 900);
      }
    };

    const onKey = (e) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) onTap();
    };
    const onPointer = (e) => { if (e.button === undefined || e.button === 0) onTap(); };
    const onSkip = () => finish(null);

    window.addEventListener('keydown', onKey, true);
    tapTargetEl.addEventListener('pointerdown', onPointer);
    skipBtnEl?.addEventListener('click', onSkip);

    // Beacon: swells into each beat, snaps on it.
    let raf = 0;
    const drawBeacon = () => {
      if (done) return;
      const phase = ((ctx.currentTime - t0) / periodSec) % 1;
      const u = phase < 0 ? 0 : phase;
      const scale = 0.72 + 0.5 * Math.pow(1 - u, 3);
      if (beaconEl) {
        beaconEl.style.transform = `scale(${scale.toFixed(3)})`;
        beaconEl.style.opacity = (0.45 + 0.55 * Math.pow(1 - u, 2)).toFixed(3);
      }
      raf = requestAnimationFrame(drawBeacon);
    };
    raf = requestAnimationFrame(drawBeacon);
  });
}
