// Range v2 device run (plan Task 16). Paste into the DevTools console of a
// page playing a song with ?rangeRenderer=v2 (see docs/range-v2-device-runs.md).
// It watches live playback for MINUTES and prints one JSON report: frame
// intervals (median/p95/p99, >100 ms stalls) for the cold start, steady
// playback and view-to-view travels, the quality levels the governor chose,
// the residency peak by owner, the Range copy/partition costs, the stage
// and backing sizes, DPR and the GPU string. Nothing is sent anywhere; the
// report is also copied to the clipboard when DevTools allows it.
(async (MINUTES = 10) => {
  const smw = window.__SMW;
  if (!smw?.sim) throw new Error('Start a song first.');
  const MiB = 1048576;
  const scene = smw.sim.biomes.rangePresentation?.scene;
  const gl = scene?.renderer?.getContext?.();
  const dbg = gl?.getExtension?.('WEBGL_debug_renderer_info');
  const gpu = gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null;
  const stage = document.querySelector('#stage');
  const buckets = { cold: [], steady: [], travel: [] };
  const levels = {};
  const partMs = [], copyMs = [];
  let peak = { bytes: 0, byOwner: null }, overcommits = 0, denials = 0, legacyFrames = 0, frames = 0;
  const t0 = performance.now(), end = t0 + MINUTES * 60000;
  let last = t0;
  console.log(`[range probe] recording ${MINUTES} min; keep the tab in front and the song playing`);
  await new Promise((done) => {
    const tick = (t) => {
      const dt = t - last;
      last = t;
      frames++;
      const pres = smw.sim.biomes.rangePresentation;
      const travelling = !!pres?.incomingViewId;
      (t - t0 < 20000 ? buckets.cold : travelling ? buckets.travel : buckets.steady).push(dt);
      levels[smw.perfLevel] = (levels[smw.perfLevel] || 0) + 1;
      if (pres?.active) { partMs.push(pres.timings.lastPartitionMs); copyMs.push(pres.timings.lastCopyMs); } else legacyFrames++;
      // The ledger snapshot allocates: sample it every 30 frames only.
      if (frames % 30 === 0 && pres?.residency) {
        const r = pres.residency.snapshot();
        const used = r.liveBytes + r.pendingBytes;
        if (used > peak.bytes) peak = { bytes: used, byOwner: Object.fromEntries(Object.entries(r.byOwner).map(([k, v]) => [k, +((v.live + v.pending) / MiB).toFixed(1)])) };
        overcommits = r.overcommits; denials = r.denials;
      }
      if (t < end) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  const stats = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
    return { frames: s.length, medianMs: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), stallsOver100ms: s.filter((x) => x > 100).length };
  };
  const report = {
    when: new Date().toISOString(), url: location.href, userAgent: navigator.userAgent, gpu,
    deviceMemoryGB: navigator.deviceMemory ?? null, dpr: devicePixelRatio,
    stage: stage ? { css: `${stage.clientWidth}x${stage.clientHeight}`, backing: `${stage.width}x${stage.height}` } : null,
    rangeTarget: scene ? `${scene.size.width}x${scene.size.height}` : null,
    budget: smw.rangeState.residency?.budget ?? null,
    minutes: MINUTES, intervals: { cold: stats(buckets.cold), steady: stats(buckets.steady), travel: stats(buckets.travel) },
    qualityLevels: levels, legacyFrames,
    residencyPeakMiB: +(peak.bytes / MiB).toFixed(1), residencyPeakByOwnerMiB: peak.byOwner, overcommits, denials,
    rangePartitionMs: stats(partMs), rangeCopyMs: stats(copyMs),
  };
  const text = JSON.stringify(report, null, 1);
  console.log(text);
  try { await navigator.clipboard.writeText(text); console.log('[range probe] report copied to the clipboard'); } catch { /* copy it from the log */ }
  return report;
})();
