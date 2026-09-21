// Runs inside page.evaluate; captures the scene at an explicit audible seek
// destination. The caller pauses playback before invoking this helper.
export function renderWorldFrame({ atMs, quality = 0, constructionSeed = 315 }) {
  // Scope deterministic construction to the synchronous seek; production RNG
  // and subsequent playback retain their normal behavior.
  const random = Math.random;
  let state = constructionSeed >>> 0;
  Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  try { window.__SMW.seek(atMs); } finally { Math.random = random; }
  // Seeking reconstructs BOTH objects. Never keep a pre-seek reference.
  const { sim, renderer, perf } = window.__SMW;
  if (perf) perf.level = quality;
  renderer.draw(sim, 1);
  const stage = document.querySelector('#stage');
  return {
    requestedMs: atMs,
    constructionSeed,
    timeMs: sim.biomes.tSec * 1000,
    simulationMs: sim.timeMs,
    response: sim.biomes.world.response || null,
    quality: perf?.level ?? null,
    reducedFlash: !!sim.biomes.reducedFlash,
    backingStore: { width: stage.width, height: stage.height },
  };
}
