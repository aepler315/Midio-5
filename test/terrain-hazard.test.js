// Musical terracing planner — accent extraction, tier quantization, apex snap,
// and decorative props that never collide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoTimeline } from '../src/core/DemoTimeline.js';
import { synthesizeEnergyCurves } from '../src/core/EnergyCurvesSynth.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { ObstacleSpawner } from '../src/sim/ObstacleSpawner.js';
import { extractAccents, Strength } from '../src/sim/PhraseAccentExtractor.js';
import { planTerraces } from '../src/sim/TerrainHazardPlanner.js';
import * as JumpPlanner from '../src/sim/JumpPlanner.js';
import { mulberry32 } from '../src/utils/math.js';
import { Role } from '../src/core/NoteEvent.js';

test('extractAccents classifies downbeats, backbeats, and hats', () => {
  const data = buildDemoTimeline({ bpm: 120, bars: 4, seed: 1 });
  const accents = extractAccents(data.timeline, data.barGrid);
  assert.ok(accents.length > 0);
  const strengths = new Set(accents.map((a) => a.strength));
  assert.ok(strengths.has(Strength.STRONG));
  assert.ok(strengths.has(Strength.MEDIUM));
  assert.ok(strengths.has(Strength.WEAK));
});

test('weak accents become decorative props that never collide', () => {
  const paramBus = new ParamBus();
  paramBus.live.obstacleDensity = 1;
  paramBus.live.jumpHeight = 1;
  const data = buildDemoTimeline({ bpm: 120, bars: 16, seed: 7 });
  const obstacles = new ObstacleSpawner(paramBus, { seed: 42 });
  obstacles.buildCandidates(data.timeline, 500, {
    energyCurves: synthesizeEnergyCurves(data.timeline, data.durationMs),
    barGrid: data.barGrid,
  });

  const props = obstacles.candidates.filter((c) => c.colliding === false);
  assert.ok(props.length > 0, 'demo timeline should yield decorative props');

  for (const p of props.slice(0, 3)) {
    assert.equal(p.kind, 'prop');
    assert.equal(p.height, JumpPlanner.HEIGHT_TIERS[0]);
    obstacles.active.push({
      wx: 100, tMs: p.tMs, height: p.height, width: p.width, kind: 'prop', colliding: false, passed: false,
    });
    const stumbled = obstacles.checkCollision(100, 30, 0);
    assert.equal(stumbled, false);
    assert.equal(obstacles.active[0].passed, true);
    obstacles.active.length = 0;
  }
});

test('snapToWindow apex bias places inside the apex band', () => {
  const kicks = [];
  for (let i = 0; i < 6; i++) kicks.push({ tMs: i * 1000, vel: 0.75 });
  const windows = JumpPlanner.coveredWindows(kicks, { obstacleHeight: 46 });
  assert.ok(windows.length > 0);
  const w = windows[0];
  const span = w.exitMs - w.enterMs;
  const lo = w.enterMs + 0.35 * span;
  const hi = w.enterMs + 0.5 * span;
  const rand = mulberry32(99);
  const snap = JumpPlanner.snapToWindow(w.takeoffMs, windows, rand, { bias: 'apex' });
  assert.ok(snap);
  assert.ok(snap.placeMs >= lo - 0.01 && snap.placeMs <= hi + 0.01,
    `placeMs=${snap.placeMs} outside apex band [${lo}, ${hi}]`);
});

test('quantizeHeight snaps to nearest terrace tier', () => {
  assert.equal(JumpPlanner.quantizeHeight(30), 28);
  assert.equal(JumpPlanner.quantizeHeight(40), 46);
  assert.equal(JumpPlanner.quantizeHeight(60), 72);
});

test('planTerraces yields tiered colliding heights from velocity and energy', () => {
  const data = buildDemoTimeline({ bpm: 120, bars: 32, seed: 1337 });
  const kicks = data.timeline
    .filter((e) => e.role === Role.RHYTHM && e.kick)
    .map((e) => ({ tMs: e.tMs, vel: e.vel }));
  const candidates = planTerraces({
    timeline: data.timeline,
    barGrid: data.barGrid,
    kicks,
    energyCurves: synthesizeEnergyCurves(data.timeline, data.durationMs),
    obstacleDensity: 1,
    jumpHeight: 1,
    beatPeriodMs: 500,
    rand: mulberry32(1),
  });
  const colliding = candidates.filter((c) => c.colliding);
  const heights = new Set(colliding.map((c) => c.height));
  assert.ok(heights.size >= 2, `expected multiple tiers, got ${[...heights]}`);
  for (const h of heights) assert.ok(JumpPlanner.HEIGHT_TIERS.includes(h));
});