import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/world/ParticleField.js';

test('firefly alpha is boosted during calm sections', () => {
  const a = new ParticleField({ kind: 'fireflies', color: '#fff', count: 10, speed: 10 }, 800, 600, 1);
  const b = new ParticleField({ kind: 'fireflies', color: '#fff', count: 10, speed: 10 }, 800, 600, 1);
  let maxA = 0, maxB = 0;
  for (let i = 0; i < 300; i++) {
    const t = i / 30;
    a.update(1 / 30, t, null, t * 1000, 0);
    b.update(1 / 30, t, null, t * 1000, 1);
    for (const p of a.particles) maxA = Math.max(maxA, p.alpha);
    for (const p of b.particles) maxB = Math.max(maxB, p.alpha);
  }
  assert.ok(maxB > maxA, `expected calm firefly alpha peak (${maxB}) to exceed energetic (${maxA})`);
  assert.ok(maxB <= 1, 'alpha must stay clamped to a valid range');
});

test('pollen alpha is boosted during calm sections', () => {
  const fakeEnergy = { sample: () => 0.4 };
  const a = new ParticleField({ kind: 'pollen', color: '#fff', count: 5, speed: 5 }, 800, 600, 2);
  const b = new ParticleField({ kind: 'pollen', color: '#fff', count: 5, speed: 5 }, 800, 600, 2);
  a.update(1 / 30, 0, fakeEnergy, 0, 0);
  b.update(1 / 30, 0, fakeEnergy, 0, 1);
  assert.ok(b.particles[0].alpha > a.particles[0].alpha);
  assert.ok(b.particles[0].alpha <= 1);
});

// --- The Wind (Movement II): every field that accepts a wind vector must
// actually be pushed by it, and a null/omitted wind must be a pure no-op
// (every consumer defaults wind to zero so existing callers are unaffected).

test('rain angle rides the wind: a strong rightward gust visibly slants the fall direction', () => {
  const calm = new ParticleField({ kind: 'rain', color: '#fff', count: 20, speed: 10 }, 800, 600, 5);
  const windy = new ParticleField({ kind: 'rain', color: '#fff', count: 20, speed: 10 }, 800, 600, 5);
  calm.update(1 / 60, 0, null, 0, 0, null);
  windy.update(1 / 60, 0, null, 0, 0, { x: 400, y: 0 });
  for (let i = 0; i < calm.particles.length; i++) {
    assert.ok(windy.particles[i].vx > calm.particles[i].vx, 'a rightward gust should push vx rightward relative to no wind');
  }
});

test('rain with no wind argument behaves exactly as before (defaults to zero)', () => {
  const a = new ParticleField({ kind: 'rain', color: '#fff', count: 10, speed: 10 }, 800, 600, 5);
  const b = new ParticleField({ kind: 'rain', color: '#fff', count: 10, speed: 10 }, 800, 600, 5);
  a.update(1 / 60, 0, null, 0, 0);
  b.update(1 / 60, 0, null, 0, 0, { x: 0, y: 0 });
  for (let i = 0; i < a.particles.length; i++) {
    assert.equal(a.particles[i].vx, b.particles[i].vx);
    assert.equal(a.particles[i].x, b.particles[i].x);
  }
});

test('snow drifts downwind: position shifts further in the wind direction than with no wind', () => {
  const calm = new ParticleField({ kind: 'snow', color: '#fff', count: 10, speed: 10 }, 800, 600, 7);
  const windy = new ParticleField({ kind: 'snow', color: '#fff', count: 10, speed: 10 }, 800, 600, 7);
  for (let i = 0; i < 30; i++) {
    calm.update(1 / 30, i / 30, null, i * 33, 0, null);
    windy.update(1 / 30, i / 30, null, i * 33, 0, { x: 300, y: 0 });
  }
  let anyFurtherRight = false;
  for (let i = 0; i < calm.particles.length; i++) {
    if (windy.particles[i].x > calm.particles[i].x) anyFurtherRight = true;
  }
  assert.ok(anyFurtherRight, 'a sustained rightward gust should carry at least one snowflake further right');
});
