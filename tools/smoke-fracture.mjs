// Drives the sim directly (bypassing real-time audio playback) with a short
// synthetic timeline so the terminal-shatter sequence can be exercised
// without waiting minutes of real time.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message + '\n' + err.stack));

await page.goto('http://localhost:5173', { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const { Conductor } = await import('/src/core/Conductor.js');
  const { ParamBus } = await import('/src/core/ParamBus.js');
  const { Simulation } = await import('/src/sim/Simulation.js');
  const { Renderer } = await import('/src/render/Renderer.js');
  const { buildDemoTimeline } = await import('/src/core/DemoTimeline.js');
  const { synthesizeEnergyCurves } = await import('/src/core/EnergyCurvesSynth.js');

  const canvas = document.getElementById('stage');
  canvas.width = 1280; canvas.height = 720;
  document.getElementById('loader').classList.add('hidden');

  const conductor = new Conductor();
  const paramBus = new ParamBus();
  const data = buildDemoTimeline({ bpm: 150, bars: 16 }); // ~25.6s, short on purpose
  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  conductor.load(data);
  const sim = new Simulation(conductor, paramBus, { bpm: data.bpm, energyCurves: data.energyCurves, canvasWidth: 1280, canvasHeight: 720 });
  const renderer = new Renderer(canvas);

  const STEP_MS = 1000 / 120;
  let t = 0;
  let sawCracks = false, sawFrozen = false, sawDone = false, frozenAtMs = null;
  let frames = 0;
  const events = [];
  let midShatterCanvas = null;
  while (t < data.durationMs + 1000 && !sawDone) {
    sim.step(STEP_MS, t + STEP_MS);
    t += STEP_MS;
    if (sim.fracture.cracks.length > 0 && !sawCracks) { sawCracks = true; events.push(`cracks at t=${Math.round(t)}`); }
    if (sim.fracture.isFrozen && !sawFrozen) { sawFrozen = true; frozenAtMs = t; events.push(`frozen at t=${Math.round(t)}`); }
    if (sim.fracture.isDone && !sawDone) { sawDone = true; events.push(`done at t=${Math.round(t)}`); }
    if (frames % 6 === 0) renderer.draw(sim, 1); // render periodically like a real rAF loop would
    if (frozenAtMs !== null && t - frozenAtMs >= 150 && !midShatterCanvas) {
      renderer.draw(sim, 1);
      midShatterCanvas = canvas.toDataURL();
    }
    frames++;
  }
  renderer.draw(sim, 1);
  const finalCanvas = canvas.toDataURL();

  return {
    durationMs: data.durationMs, sawCracks, sawFrozen, sawDone, events,
    crackCount: sim.fracture.cracks.length, stress: sim.fracture.stress,
    midShatterCanvas, finalCanvas,
  };
});

console.log('result:', JSON.stringify({ ...result, midShatterCanvas: undefined, finalCanvas: undefined }, null, 2));
console.log('errors:', JSON.stringify(errors, null, 2));

const fs = await import('node:fs');
if (result.midShatterCanvas) {
  fs.writeFileSync('/home/user/Midio-5/.smoke/fracture_mid.png', Buffer.from(result.midShatterCanvas.split(',')[1], 'base64'));
}
if (result.finalCanvas) {
  fs.writeFileSync('/home/user/Midio-5/.smoke/fracture_final.png', Buffer.from(result.finalCanvas.split(',')[1], 'base64'));
}
await browser.close();
