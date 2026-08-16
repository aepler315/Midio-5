import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObstacleSpawner, emergenceEnvelope, dissolveEnvelope } from '../src/sim/ObstacleSpawner.js';

function spawnerWith(active) {
  const s = new ObstacleSpawner(null, { width: 28 });
  s.active = active;
  return s;
}

test('groundedShadows excludes veil and echo', () => {
  const active = [
    { wx: 1000, tMs: 0, height: 46, width: 28, archetype: 'thorn' },
    { wx: 1010, tMs: 0, height: 46, width: 28, archetype: 'veil' },
    { wx: 1020, tMs: 0, height: 46, width: 28, archetype: 'echo' },
    { wx: 1030, tMs: 0, height: 46, width: 28, archetype: 'geo' },
    { wx: 1040, tMs: 0, height: 46, width: 28, archetype: 'pipe' },
  ];
  const s = spawnerWith(active);
  const shadows = s.groundedShadows(1000, 640, () => 500);
  assert.equal(shadows.length, 3, 'only thorn/geo/pipe get shadows');
});

test('groundedShadows excludes off-screen obstacles', () => {
  const active = [
    { wx: 1000, tMs: 0, height: 46, width: 28, archetype: 'thorn' }, // on-screen (x = 640)
    { wx: 1000 - 5000, tMs: 0, height: 46, width: 28, archetype: 'thorn' }, // far off left
    { wx: 1000 + 5000, tMs: 0, height: 46, width: 28, archetype: 'thorn' }, // far off right
  ];
  const s = spawnerWith(active);
  const shadows = s.groundedShadows(1000, 640, () => 500);
  assert.equal(shadows.length, 1);
});

test('groundedShadows reports presence matching emergence * dissolve, same inputs draw() sees', () => {
  const worldX = 1000, originX = 640;
  const distanceAhead = 80; // not yet passed
  const wx = worldX + distanceAhead;
  const active = [{ wx, tMs: 0, height: 46, width: 28, archetype: 'thorn' }];
  const s = spawnerWith(active);
  const [shadow] = s.groundedShadows(worldX, originX, () => 500);
  const expectedPresence = emergenceEnvelope(distanceAhead) * 1; // dissolve is 1 pre-pass
  assert.ok(Math.abs(shadow.presence - expectedPresence) < 1e-9);
});

test('groundedShadows presence matches dissolveEnvelope once passed', () => {
  const worldX = 1000, originX = 640;
  const distanceBehind = 60;
  const wx = worldX - distanceBehind;
  const active = [{ wx, tMs: 0, height: 46, width: 28, archetype: 'geo' }];
  const s = spawnerWith(active);
  const [shadow] = s.groundedShadows(worldX, originX, () => 500);
  const expectedPresence = 1 * dissolveEnvelope(distanceBehind); // emergence is 1 once passed
  assert.ok(Math.abs(shadow.presence - expectedPresence) < 1e-9);
});

test('groundedShadows cx tracks the terrain under each obstacle via groundYAt', () => {
  const worldX = 1000, originX = 640;
  const active = [
    { wx: 1000, tMs: 0, height: 46, width: 28, archetype: 'pipe' },
    { wx: 1100, tMs: 0, height: 46, width: 28, archetype: 'pipe' }, // within EMERGENCE_PX
  ];
  const s = spawnerWith(active);
  const groundYAt = (wx) => 400 + (wx - 1000) * 0.5; // a sloped stand-in terrain
  const shadows = s.groundedShadows(worldX, originX, groundYAt);
  assert.equal(shadows[0].groundY, groundYAt(1000));
  assert.equal(shadows[1].groundY, groundYAt(1100));
});
