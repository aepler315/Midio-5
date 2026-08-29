// Seven-band stem separation via parallel OfflineAudioContext renders with
// Linkwitz-Riley 24dB/oct crossovers (spec §1.2.2). LR4 edges are chosen
// because adjacent bands sum flat and phase-coherent — the seven stems,
// summed, reconstruct the mix without comb notches.
import { BANDS } from './bands.js';

async function renderBand(srcBuf, fLo, fHi) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(srcBuf.numberOfChannels, srcBuf.length, srcBuf.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = srcBuf;
  let node = src;

  const chain = [];
  if (fLo > 20) chain.push(['highpass', fLo], ['highpass', fLo]);
  if (fHi < 16000) chain.push(['lowpass', fHi], ['lowpass', fHi]);
  for (const [type, f] of chain) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Math.SQRT1_2; // 1/sqrt(2) — Butterworth Q, two cascaded = LR4
    node.connect(b);
    node = b;
  }
  node.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/** @returns {Promise<AudioBuffer[]>} 7 band-limited AudioBuffers, same length/rate as the source. */
export async function separateStems(sourceBuffer, onProgress = null) {
  let done = 0;
  const renders = BANDS.map(([lo, hi]) =>
    renderBand(sourceBuffer, lo, hi).then((buf) => {
      done++;
      if (onProgress) onProgress(done / BANDS.length);
      return buf;
    }));
  return Promise.all(renders);
}

/**
 * Renders the 7 bands ONE AT A TIME rather than all in parallel, handing
 * each to `onBand(index, buffer)` as soon as it's ready. separateStems'
 * Promise.all keeps every band's full-length AudioBuffer resident
 * simultaneously purely so the caller can iterate them together afterward
 * -- 7 stereo buffers the length of the source track, ~565MB for a 4-minute
 * 44.1kHz song, and a real OOM risk on mobile. A caller that only needs each
 * band's compact envelope (a few hundred bytes/second, not the raw audio)
 * can extract it inside `onBand` and let the buffer fall out of scope before
 * the next render starts, so peak memory is bounded by ONE band's buffer
 * rather than all seven.
 *
 * Sequential rather than parallel: OfflineAudioContext rendering is native
 * and reasonably fast on its own, so the loss from giving up 7-way
 * concurrency is a rendering-time cost; the 565MB simultaneous peak is a
 * memory-budget cost that can crash the tab outright. The former is the
 * safer trade.
 */
export async function separateStemsSequential(sourceBuffer, onBand, onProgress = null) {
  for (let i = 0; i < BANDS.length; i++) {
    const [lo, hi] = BANDS[i];
    const buf = await renderBand(sourceBuffer, lo, hi);
    await onBand(i, buf);
    if (onProgress) onProgress((i + 1) / BANDS.length);
  }
}
