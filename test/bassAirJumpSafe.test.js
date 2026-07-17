import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bassAirJumpSafe } from '../src/sim/Simulation.js';

test('no obstacle ahead is always safe', () => {
  assert.equal(bassAirJumpSafe(null, 0), true);
});

test('an obstacle already behind is safe (nothing left to endanger)', () => {
  assert.equal(bassAirJumpSafe({ wx: 100 }, 200), true);
});

test('an obstacle far enough ahead is safe', () => {
  assert.equal(bassAirJumpSafe({ wx: 1000 }, 0, 260), true);
});

test('an obstacle imminently ahead is NOT safe -- the chart schedule must not be risked', () => {
  assert.equal(bassAirJumpSafe({ wx: 100 }, 0, 260), false);
  assert.equal(bassAirJumpSafe({ wx: 260 }, 0, 260), false); // right at the boundary: still guarded
});
