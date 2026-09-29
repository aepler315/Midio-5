// Range v2 rock stage: per-frame geometry uploads reuse GPU attributes, and
// an empty first frame (no pools yet) still allocates them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { RockStageGL } from '../src/world/alpine/RockStageGL.js';

const upload = (geometry, attrs, indices = null) => RockStageGL.prototype._upload.call({ THREE }, geometry, attrs, indices);

test('an empty first upload allocates the attributes, and later frames reuse them', () => {
  const g = new THREE.BufferGeometry();
  upload(g, { position: [new Float32Array(0), 3] });
  const first = g.getAttribute('position');
  assert.ok(first, 'allocated on the first frame even with nothing to draw');
  upload(g, { position: [Float32Array.from([1, 2, 3, 4, 5, 6]), 3] });
  assert.equal(g.getAttribute('position'), first, 'fits: rewritten in place');
  assert.deepEqual([...g.getAttribute('position').array.slice(0, 6)], [1, 2, 3, 4, 5, 6]);
  upload(g, { position: [new Float32Array(3 * 500), 3] });
  assert.notEqual(g.getAttribute('position'), first, 'outgrown: reallocated');
});
