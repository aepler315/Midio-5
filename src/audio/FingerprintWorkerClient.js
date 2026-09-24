// Fingerprint a decoded song without holding the main thread for it.
//
// A five-minute song's fingerprint is about 1.2s of FFTs, and it runs while
// the song's opening is analysed (OpeningAnalysis.js), so on the main thread
// it held the world picker back by that much. The cheap half -- resampling
// each channel to 8kHz, and the level and stereo measurements -- stays here;
// the FFTs run in fingerprintWorker.js. The result is identical to
// fingerprintBuffer's. Anywhere a module worker cannot start, it falls back
// to the main thread.
import { fingerprintBuffer, fingerprintInputs, fingerprintResult } from './SongFingerprint.js';

function startWorker() {
  if (typeof Worker !== 'function' || typeof URL !== 'function') return null;
  try {
    return new Worker(new URL('./fingerprintWorker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Resolves with fingerprintBuffer(buffer)'s result. */
export async function fingerprintBufferOffThread(buffer) {
  const worker = startWorker();
  if (!worker) return fingerprintBuffer(buffer);
  const { signals, signal, durationMs } = fingerprintInputs(buffer);
  const frames = await new Promise((resolve) => {
    const finish = (value) => { worker.terminate(); resolve(value); };
    worker.onmessage = (e) => finish(e.data?.ok ? e.data : null);
    // A worker that cannot load its module reports an error event.
    worker.onerror = (e) => { e?.preventDefault?.(); finish(null); };
    worker.postMessage({ signals }, signals.map((s) => s.buffer));
  });
  return frames ? fingerprintResult(frames, signal, durationMs) : fingerprintBuffer(buffer);
}
