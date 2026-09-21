// Runs inside page.evaluate; captures the scene at an explicit audible seek
// destination. The caller pauses playback before invoking this helper.
export function renderWorldFrame({ atMs, quality = 0 }) {
  window.__SMW.seek(atMs);
  // Seeking reconstructs BOTH objects. Never keep a pre-seek reference.
  const { sim, renderer, perf } = window.__SMW;
  if (perf) perf.level = quality;
  renderer.draw(sim, 1);
  const stage = document.querySelector('#stage');
  return {
    requestedMs: atMs,
    timeMs: sim.biomes.tSec * 1000,
    simulationMs: sim.timeMs,
    response: sim.biomes.world.response || null,
    quality: perf?.level ?? null,
    reducedFlash: !!sim.biomes.reducedFlash,
    backingStore: { width: stage.width, height: stage.height },
  };
}
