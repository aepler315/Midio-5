import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundPatches } from '../src/world/alpine/GroundMaterial.js';

test('patch identities depend on world sectors, not viewport width or draw order', () => {
  const a = buildGroundPatches({ seed: 315, biomeKey: 'RAINFOREST', worldX: 1000, viewWidth: 600, moisture: .85 });
  const b = buildGroundPatches({ seed: 315, biomeKey: 'RAINFOREST', worldX: 1000, viewWidth: 1200, moisture: .85 });
  assert.ok(a.length <= 24 && b.length <= 24);
  assert.deepEqual(a.filter(p => p.wx >= 1000 && p.wx < 1550), b.filter(p => p.wx >= 1000 && p.wx < 1550));
});

test('cold and dry materials cannot produce water receivers', () => {
  for (const biomeKey of ['DESERT', 'ICEFIELD']) {
    for (const worldX of [0, 10_000, 100_000, 1_000_000]) {
      const patches = buildGroundPatches({ seed: 315, biomeKey, worldX, viewWidth: 1280, moisture: 0 });
      assert.ok(patches.every(p => p.kind !== 'pool'));
      assert.ok(patches.every(p => p.widthPx >= 16 && p.widthPx <= 90));
    }
  }
});
