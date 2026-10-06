// WeatherDirector ground-cover accumulation, and the Simulation pose that
// applies the resulting render-only slide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherDirector } from '../src/sim/WeatherDirector.js';

test('WeatherDirector: sustained snowfall settles ground cover; other skies melt it', () => {
  const w = new WeatherDirector();
  // Force a live snowfall directly (kind defaults to snow) and integrate.
  w.intensity = 0.9;
  for (let t = 0; t < 30000; t += 100) w.update(t, 0.1, { valence: 0, energySlow: 0.9 });
  assert.ok(w.groundCover > 0.5, `expected real accumulation after ~30s of snow, got ${w.groundCover}`);
  assert.ok(w.state.groundCover === w.groundCover, 'cover rides the public state');

  // A mood swing to petals melts it back down.
  const covered = w.groundCover;
  for (let t = 30000; t < 50000; t += 100) w.update(t, 0.1, { valence: 0.9, energySlow: 0.9 });
  assert.ok(w.groundCover < covered * 0.3, `expected a thaw under petals, got ${w.groundCover} (was ${covered})`);
});

// The skid must move Midio's BODY, never the world->screen origin that
// ground/obstacles/burrow anchor on -- folding it into midioX translated
// the whole world with him and cancelled the visible slide.
test('lerpState: stage anchor owns the world origin independently of deprecated actor coordinates', async () => {
  const { Simulation } = await import('../src/sim/Simulation.js');
  const stub = {
    prev: { worldX: 0, midioY: 540, slipX: 10, scaleX: 1, scaleY: 1, leanDeg: 0 },
    curr: { worldX: 2, midioY: 540, slipX: 20, scaleX: 1, scaleY: 1, leanDeg: 0 },
    stageAnchor: { x: 220 },
    midio: { screenX: 999, slipX: 20 },
    jump: { airborne: false },
  };
  const pose = Simulation.prototype.lerpState.call(stub, 0.5);
  assert.equal(pose.originX, 220, 'stage origin never slips or follows an actor');
  assert.equal(pose.midioX, 220, 'deprecated origin alias remains compatible');
  assert.ok(Math.abs(pose.midioDrawX - 235) < 1e-9, 'his body slides by the lerped skid (15px)');
});
