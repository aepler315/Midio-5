// The Forest Service map under the Range: it surfaces in quiet passages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTopoReveal, topoRevealAt, TOPO_OPENING_MS, TOPO_RISE_MS, TOPO_HOLD_MS } from '../src/world/alpine/TopoReveal.js';
import { SCENE_FRAG } from '../src/world/alpine/TerrainMaterial.js';
import { TREE_COMMON } from '../src/world/alpine/ForestGL.js';

// A song as song-relative energy over time (ms -> 0..1).
const curves = (fn) => ({ globalEnergyNorm: fn });
// Loud, a 20 s breakdown from 60 s, loud again from 80 s.
const breakdown = (t) => (t >= 60000 && t < 80000 ? 0.15 : 0.7);

test('a song with no quiet passages keeps its map under the land', () => {
  for (const level of [0.7, 0.1]) {
    const r = compileTopoReveal({ energyCurves: curves(() => level), durationMs: 120000 });
    for (let t = 0; t <= 120000; t += 500) assert.equal(r.at(t), 0);
  }
  // A beat on every half second is not a breakdown either.
  const beat = compileTopoReveal({ energyCurves: curves((t) => (t % 500 < 100 ? 0.95 : 0.3)), durationMs: 120000 });
  for (let t = 0; t <= 120000; t += 500) assert.equal(beat.at(t), 0);
});

test('a breakdown brings the map up, and the song lifting sinks it again', () => {
  const r = compileTopoReveal({ energyCurves: curves(breakdown), durationMs: 120000 });
  assert.equal(r.at(59000), 0, 'nothing before the breakdown');
  assert.ok(r.at(61000) < 0.05, 'a single soft bar is not a breakdown');
  assert.ok(r.at(60000 + TOPO_HOLD_MS + 2000 + TOPO_RISE_MS) > 0.99, 'fully up once the quiet holds');
  assert.ok(r.at(79000) > 0.99);
  assert.ok(r.at(83000) < 0.2, 'sinking once the song lifts');
  assert.equal(r.at(90000), 0);
});

test('a short breakdown in an otherwise steady song still brings the map up', () => {
  // 10 s at 0.1 inside 240 s at 0.8: p10 sits on the loud level.
  const r = compileTopoReveal({ energyCurves: curves((t) => (t >= 100000 && t < 110000 ? 0.1 : 0.8)), durationMs: 240000 });
  assert.equal(r.at(90000), 0);
  assert.ok(r.at(109000) > 0.9, `up by the end of the dip (${r.at(109000)})`);
  assert.equal(r.at(130000), 0);
});

test('the opening belongs to the arrival, not the map', () => {
  // A soft intro, then the song proper.
  const r = compileTopoReveal({ energyCurves: curves((t) => (t < 30000 ? 0.1 : 0.7)), durationMs: 120000 });
  assert.equal(r.at(TOPO_OPENING_MS - 100), 0);
  assert.ok(r.at(TOPO_OPENING_MS + TOPO_RISE_MS + 500) > 0.99);
});

test('the reveal is a pure function of heard time (seek either way)', () => {
  const r = compileTopoReveal({ energyCurves: curves(breakdown), durationMs: 120000 });
  const forward = [70000, 82000, 65000, 70000].map((t) => r.at(t));
  assert.equal(forward[0], forward[3]);
  for (const v of forward) assert.ok(v >= 0 && v <= 1);
});

test('without an energy curve, or with an override, the reveal is well defined', () => {
  assert.equal(compileTopoReveal({}).at(5000), 0);
  assert.equal(topoRevealAt({ energyCurves: null }, 5000), 0);
  assert.equal(topoRevealAt({ topoOverride: 0.4 }, 5000), 0.4);
  assert.equal(topoRevealAt({ terrainPreview: true, energyCurves: curves(() => 0.1), durationMs: 60000 }, 30000), 0);
});

test('the terrain draws the map and the forest folds into it from the same mask', () => {
  assert.match(SCENE_FRAG, /float topo = topoMask\(vWorld\.xz\)/);
  assert.match(TREE_COMMON, /1\.0 - topoMask\(iPos\.xz\)/);
});
