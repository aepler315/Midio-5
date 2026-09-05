import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPH_SHAPES, layoutTextPath, placeGlyph } from '../src/world/LyricGlyph.js';

test('GLYPH_SHAPES: every shape has at least 3 dots with x,y in [0,1]', () => {
  for (const [id, dots] of Object.entries(GLYPH_SHAPES)) {
    assert.ok(dots.length >= 3, `${id} has fewer than 3 dots`);
    for (const d of dots) {
      assert.ok(d.x >= 0 && d.x <= 1, `${id} dot x out of range: ${d.x}`);
      assert.ok(d.y >= 0 && d.y <= 1, `${id} dot y out of range: ${d.y}`);
    }
  }
});

test('layoutTextPath: returns non-empty array for a word', () => {
  const path = layoutTextPath('HELLO');
  assert.ok(Array.isArray(path));
  assert.ok(path.length > 0);
  for (const p of path) {
    assert.ok(typeof p.x === 'number');
    assert.ok(typeof p.y === 'number');
  }
});

test('layoutTextPath: single character produces points', () => {
  const path = layoutTextPath('A');
  assert.ok(path.length > 0);
});

test('layoutTextPath: empty string returns empty array', () => {
  const path = layoutTextPath('');
  assert.ok(Array.isArray(path));
  assert.strictEqual(path.length, 0);
});

test('layoutTextPath: path is roughly centered (x range spans around 0)', () => {
  const path = layoutTextPath('TEST');
  const xs = path.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  assert.ok(minX < 0, 'path should extend left of center');
  assert.ok(maxX > 0, 'path should extend right of center');
});

test('placeGlyph: returns dots within bounds', () => {
  const bounds = { xMin: 100, xMax: 500, yMin: 50, yMax: 400 };
  const dots = placeGlyph('heart', 300, 200, 80, bounds);
  assert.ok(dots.length >= 3);
  for (const d of dots) {
    assert.ok(d.x >= bounds.xMin && d.x <= bounds.xMax, `x ${d.x} outside bounds`);
    assert.ok(d.y >= bounds.yMin && d.y <= bounds.yMax, `y ${d.y} outside bounds`);
  }
});

test('placeGlyph: unknown glyph returns null or empty', () => {
  const dots = placeGlyph('nonexistent', 300, 200, 80, { xMin: 0, xMax: 1280, yMin: 0, yMax: 720 });
  assert.ok(!dots || dots.length === 0);
});
