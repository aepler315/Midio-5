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
