import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ObstacleSpawner, obstacleArchetype, emergenceEnvelope, dissolveEnvelope, obstacleInJumpWindow,
  ARCHETYPES, EMERGENCE_PX, DISSOLVE_PX,
} from '../src/sim/ObstacleSpawner.js';

function fakeCtx() {
  const calls = { fill: 0, stroke: 0, save: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    save() { calls.save++; }, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    quadraticCurveTo() {}, arc() {}, rotate() {}, scale() {}, translate() {},
    fill() { calls.fill++; }, stroke() { calls.stroke++; }, fillRect() {}, strokeRect() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set globalAlpha(_v) {}, set globalCompositeOperation(_v) {},
  };
}

test('ARCHETYPES lists all three ambient obstacle kinds', () => {
  assert.deepEqual([...ARCHETYPES], ['thorn', 'veil', 'echo']);
});

test('obstacleArchetype partitions [0,1) evenly across the three kinds, deterministically', () => {
  assert.equal(obstacleArchetype(0), 'thorn');
  assert.equal(obstacleArchetype(0.32), 'thorn');
  assert.equal(obstacleArchetype(0.34), 'veil');
  assert.equal(obstacleArchetype(0.65), 'veil');
  assert.equal(obstacleArchetype(0.67), 'echo');
  assert.equal(obstacleArchetype(0.99), 'echo');
});

test('emergenceEnvelope: 0 far ahead, ramps to 1 by the time it arrives, clamped both ends', () => {
  assert.equal(emergenceEnvelope(EMERGENCE_PX * 3), 0);
  assert.equal(emergenceEnvelope(0), 1);
  assert.equal(emergenceEnvelope(-50), 1, 'already past the emergence point should stay fully formed');
  const half = emergenceEnvelope(EMERGENCE_PX / 2);
  assert.ok(half > 0 && half < 1);
});

test('dissolveEnvelope: 1 right at the moment of passing, eases to 0 over DISSOLVE_PX, clamped', () => {
  assert.equal(dissolveEnvelope(0), 1);
  assert.equal(dissolveEnvelope(DISSOLVE_PX * 3), 0);
  const half = dissolveEnvelope(DISSOLVE_PX / 2);
  assert.ok(half > 0 && half < 1);
});

test('a fresh ObstacleSpawner has no active obstacles and draw() is a safe no-op', () => {
  const spawner = new ObstacleSpawner({ live: { obstacleDensity: 1 } });
  const ctx = fakeCtx();
  assert.doesNotThrow(() => spawner.draw(ctx, 0, 220, 480));
  assert.equal(ctx.calls.save, 0);
});

test('spawned obstacles carry a deterministic archetype/phase and draw without throwing across the full lifecycle', () => {
  const spawner = new ObstacleSpawner({ live: { obstacleDensity: 1 } }, { seed: 7 });
  // Force a couple of candidates directly (bypassing buildCandidates' musical
  // placement logic, which is covered by obstacleSafety.test.js) to exercise update()'s spawn path.
  spawner.candidates = [{ tMs: 1000 }, { tMs: 1400 }];
  spawner.update(0, 0, 0.22); // scrollSpeedPxMs ~ WORLD_SPEED_PX_S/1000
  assert.ok(spawner.active.length > 0, 'expected at least one obstacle to spawn at density=1');
  for (const o of spawner.active) {
    assert.ok(['thorn', 'veil', 'echo'].includes(o.archetype));
    assert.ok(Number.isFinite(o.phase));
  }

  const ctx = fakeCtx();
  // Approaching, at arrival, and past (dissolving) -- all three lifecycle phases.
  for (const worldX of [-500, spawner.active[0].wx, spawner.active[0].wx + 200]) {
    assert.doesNotThrow(() => spawner.draw(ctx, worldX, 220, 480, {
      nowMs: 1000, energyCurves: null, haloColor: '#8a3a6b', wind: { x: 5, y: 0 }, particleMul: 1, reducedFlash: false,
    }));
  }
});

test('draw() never throws with an energyCurves-driven pulse, reduced-flash, or fractional particleMul', () => {
  const spawner = new ObstacleSpawner({ live: { obstacleDensity: 1 } }, { seed: 3 });
  spawner.candidates = [{ tMs: 500 }];
  spawner.update(0, 0, 0.22);
  const fakeEnergy = { globalEnergy: () => 0.7, sample: () => 0.5 };
  const ctx = fakeCtx();
  assert.doesNotThrow(() => spawner.draw(ctx, 0, 220, 480, {
    nowMs: 500, energyCurves: fakeEnergy, haloColor: '#00ffd0', particleMul: 0.4, reducedFlash: true,
  }));
});

test('collision/placement math is untouched: checkCollision and nearestAhead behave as before', () => {
  const spawner = new ObstacleSpawner({ live: { obstacleDensity: 1 } });
  spawner.active = [{ wx: 100, width: 28, height: 46, passed: false }];
  assert.equal(spawner.nearestAhead(0).wx, 100);
  assert.equal(spawner.checkCollision(100, 23, 10), true, 'too low to clear should stumble');
  assert.equal(spawner.active[0].passed, true);
});

test('obstacleInJumpWindow: true when the obstacle\'s crossing time falls inside the jump\'s hang window', () => {
  const jump = { jumpStartMs: 1000, D: 400 };
  assert.equal(obstacleInJumpWindow(jump, { tMs: 1200 }), true, 'inside the window');
  assert.equal(obstacleInJumpWindow(jump, { tMs: 1000 }), true, 'right at the start (inclusive)');
  assert.equal(obstacleInJumpWindow(jump, { tMs: 1400 }), true, 'right at the end (inclusive)');
  assert.equal(obstacleInJumpWindow(jump, { tMs: 999 }), false, 'just before');
  assert.equal(obstacleInJumpWindow(jump, { tMs: 1401 }), false, 'just after');
});

test('obstacleInJumpWindow: false/never throws on missing or malformed input', () => {
  const jump = { jumpStartMs: 1000, D: 400 };
  assert.equal(obstacleInJumpWindow(null, { tMs: 1200 }), false);
  assert.equal(obstacleInJumpWindow(jump, null), false);
  assert.equal(obstacleInJumpWindow({ jumpStartMs: NaN, D: 400 }, { tMs: 1200 }), false);
  assert.equal(obstacleInJumpWindow(jump, { tMs: NaN }), false);
  assert.equal(obstacleInJumpWindow({}, {}), false);
});
