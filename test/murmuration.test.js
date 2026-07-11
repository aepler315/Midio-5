import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Murmuration } from '../src/world/Murmuration.js';

test('wind assist nudges the flock without overriding its own steering: a strong sustained gust shifts the centroid downwind', () => {
  const calm = new Murmuration(800, 600, 3);
  const windy = new Murmuration(800, 600, 3);
  for (let i = 0; i < 180; i++) {
    calm.update(i * 16.6, 1 / 60, null, 0, null);
    windy.update(i * 16.6, 1 / 60, null, 0, { x: 500, y: 0 });
  }
  const cCalm = calm._centroid(), cWindy = windy._centroid();
  // Wrap-aware shortest delta -- same trick the class uses internally.
  const dx = ((cWindy.x - cCalm.x + 1200) % 800) - 400;
  assert.ok(dx > 0, `expected the windy flock's centroid to drift right of the calm one, got dx=${dx}`);
});

test('no wind argument is a pure no-op: identical seeds produce identical flocks with or without an explicit null', () => {
  const a = new Murmuration(800, 600, 11);
  const b = new Murmuration(800, 600, 11);
  for (let i = 0; i < 60; i++) {
    a.update(i * 16.6, 1 / 60, null, 0);
    b.update(i * 16.6, 1 / 60, null, 0, null);
  }
  for (let i = 0; i < a.boids.length; i++) {
    assert.equal(a.boids[i].x, b.boids[i].x);
    assert.equal(a.boids[i].y, b.boids[i].y);
  }
});
