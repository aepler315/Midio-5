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
