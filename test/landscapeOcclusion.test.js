import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleCrestFraction } from '../tools/lib/landscape-visibility.mjs';

test('crest visibility interpolates by x and names the occluder', () => {
  const crest = [{ x: 0, y: 100 }, { x: 100, y: 100 }];
  const open = visibleCrestFraction(crest, []);
  assert.equal(open.fraction, 1);
  assert.equal(open.longestRun, 1);
  const blocked = visibleCrestFraction(crest, [
    { id: 'L5', samples: [{ x: 0, y: 80 }, { x: 100, y: 80 }] },
  ]);
  assert.equal(blocked.fraction, 0);
  assert.equal(blocked.dominant, 'L5');
  const ground = visibleCrestFraction(crest, [
    { id: 'ground', samples: [{ x: 0, y: 140 }, { x: 100, y: 140 }] },
  ]);
  assert.equal(ground.fraction, 1);
  const half = visibleCrestFraction(
    [{ x: 0, y: 100 }, { x: 50, y: 100 }, { x: 100, y: 100 }],
    [{ id: 'L4', samples: [{ x: 0, y: 90 }, { x: 40, y: 90 }, { x: 100, y: 140 }] }],
  );
  assert.ok(half.fraction > 0 && half.fraction < 1);
});
