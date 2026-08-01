// Song-form recognition: sections that are the same music get the same
// structural label (SongForm.analyzeSongForm), so recurrences wear the
// same face downstream (BiomeManager).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSongForm, cosineSim } from '../src/world/SongForm.js';

test('cosineSim: identical direction is 1, orthogonal is 0, opposite is -1, zero-vector is 0', () => {
  assert.ok(Math.abs(cosineSim([1, 2, 3], [2, 4, 6]) - 1) < 1e-9, 'a scaled copy points the same way');
  assert.equal(cosineSim([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSim([1, 1], [-1, -1]) + 1) < 1e-9);
  assert.equal(cosineSim([0, 0], [1, 1]), 0, 'no shape to compare');
});

// Two recognizable timbres: a bass-forward "chorus" and an airy "verse".
const CHORUS = { energy: 0.8, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
const VERSE = { energy: 0.35, shape: [0.1, 0.15, 0.3, 0.5, 0.6, 0.7, 0.8] };
const BRIDGE = { energy: 0.55, shape: [0.2, 0.3, 0.7, 0.8, 0.5, 0.3, 0.2] };

test('an A-B-A-C-B form reads back exactly [0,1,0,2,1]', () => {
  const labels = analyzeSongForm([VERSE, CHORUS, VERSE, BRIDGE, CHORUS]);
  assert.deepEqual(labels, [0, 1, 0, 2, 1]);
});

test('a returning section matches the AVERAGE of its prior selves, not just the last', () => {
  // Slightly drifting choruses still cluster together.
  const c1 = { energy: 0.8, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
  const c2 = { energy: 0.78, shape: [0.88, 0.82, 0.42, 0.28, 0.22, 0.14, 0.12] };
  const c3 = { energy: 0.82, shape: [0.92, 0.78, 0.38, 0.32, 0.18, 0.16, 0.09] };
  const labels = analyzeSongForm([c1, VERSE, c2, VERSE, c3]);
  assert.deepEqual(labels, [0, 1, 0, 1, 0], 'three drifting choruses and two verses');
});

test('two sections at the same energy but different timbre stay distinct', () => {
  const bassy = { energy: 0.6, shape: [0.9, 0.8, 0.3, 0.2, 0.1, 0.1, 0.1] };
  const trebly = { energy: 0.6, shape: [0.1, 0.1, 0.1, 0.2, 0.3, 0.8, 0.9] };
  assert.deepEqual(analyzeSongForm([bassy, trebly]), [0, 1]);
});

test('two sections with identical timbre merge even across a small energy gap', () => {
  const a = { energy: 0.5, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
  const b = { energy: 0.6, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
  assert.deepEqual(analyzeSongForm([a, b]), [0, 0]);
});

test('a big energy gap keeps even identically-voiced sections apart (energy gate)', () => {
  const soft = { energy: 0.1, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
  const loud = { energy: 0.9, shape: [0.9, 0.8, 0.4, 0.3, 0.2, 0.15, 0.1] };
  assert.deepEqual(analyzeSongForm([soft, loud]), [0, 1], 'same shape, but > energyTol apart');
});

test('a monotonically shifting sequence yields all-distinct labels', () => {
  const secs = [];
  for (let i = 0; i < 5; i++) {
    const shape = [0, 0, 0, 0, 0, 0, 0];
    shape[i] = 1; shape[i + 1] = 0.5; // a moving spectral bump -- each unlike the last
    secs.push({ energy: 0.5, shape });
  }
  const labels = analyzeSongForm(secs);
  assert.equal(new Set(labels).size, labels.length, 'no two adjacent-ish sections merge');
});

test('deterministic: the same input always labels the same way', () => {
  const seq = [VERSE, CHORUS, BRIDGE, CHORUS, VERSE, CHORUS];
  assert.deepEqual(analyzeSongForm(seq), analyzeSongForm(seq));
});
