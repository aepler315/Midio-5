// Item 4 — the obstacle⇄jump contract. Drives the gameplay subsystems
// (Conductor + ParamBus + JumpController + ObstacleSpawner) deterministically
// over seeded demo timelines and asserts zero unavoidable collisions: every
// placed colliding terrace must arrive under a covered arc. No BiomeManager
// (which needs a canvas), so this runs in `npm test` alongside the other node tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { JumpController } from '../src/sim/JumpController.js';
import { ObstacleSpawner } from '../src/sim/ObstacleSpawner.js';
import { ComboSystem } from '../src/sim/ComboSystem.js';
import { buildDemoTimeline } from '../src/core/DemoTimeline.js';
import { synthesizeEnergyCurves } from '../src/core/EnergyCurvesSynth.js';
import { Role } from '../src/core/NoteEvent.js';
import { GroundField } from '../src/world/GroundField.js';
import { hashSeed } from '../src/utils/math.js';
import * as JumpPlanner from '../src/sim/JumpPlanner.js';

const STEP_MS = 1000 / 120;
const WORLD_SPEED_PX_S = 220;
const HALF_WIDTH = 23 * 1.23; // Midio.halfWidth (scaled with MIDIO_SCALE)
const GROUND_Y = 480;

// Replay Simulation.step's gameplay slice without the canvas-bound world
// systems, returning every colliding-terrace stumble (contract says none).
function runTimeline({
  bpm, seed, bars = 48, jumpHeight = 1, obstacleDensity = 1, useGround = false,
}) {
  const conductor = new Conductor();
  const paramBus = new ParamBus();
  paramBus.live.jumpHeight = jumpHeight;
  paramBus.live.obstacleDensity = obstacleDensity;
  paramBus.live.scrollSpeed = 1;

  const data = buildDemoTimeline({ bpm, bars, seed });
  conductor.load(data);
  const energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);

  const obstacles = new ObstacleSpawner(paramBus, { seed: seed + 99 });
  obstacles.buildCandidates(conductor.timeline, 60000 / bpm, {
    energyCurves,
    barGrid: data.barGrid,
  });

  const jump = new JumpController(paramBus);
  const combo = new ComboSystem();
  const ground = useGround ? new GroundField({
    baseY: GROUND_Y,
    canvasWidth: 1280,
    durationMs: data.durationMs,
    barGrid: data.barGrid,
    beatMs: 60000 / bpm,
    obstacleTimes: obstacles.candidates.filter((c) => c.colliding).map((c) => c.tMs),
    seed: hashSeed(`${seed}:${bpm}:ground`),
  }) : null;

  conductor.on(Role.RHYTHM, (evt) => {
    if (evt.kick) {
      const o = obstacles.nearestAhead(worldX);
      let obstacle = o;
      if (o && ground) {
        obstacle = {
          tMs: o.tMs,
          height: o.height + (GROUND_Y - ground.heightAt(o.wx, conductorTime)),
        };
      }
      jump.onKick(evt, conductorTime, obstacle, combo.M);
    }
  });

  let worldX = 0;
  let conductorTime = 0;
  const collisions = [];

  for (let t = STEP_MS; t <= data.durationMs + 1000; t += STEP_MS) {
    conductorTime = t;
    jump.clearFrameFlags();
    combo.clearFrameFlags();
    conductor.dispatchUpTo(t);
    jump.update(t);
    if (ground) ground.update(t, STEP_MS / 1000, energyCurves, worldX);
    combo.update(t, jump.beatPeriodMs);

    const scrollSpeedPxMs = (WORLD_SPEED_PX_S * paramBus.live.scrollSpeed) / 1000;
    const stumbled = obstacles.checkCollision(worldX, HALF_WIDTH, jump.y, ground, t);
    if (stumbled) {
      const o = obstacles.active.find((x) => x.passed && x.colliding !== false);
      collisions.push({ t: Math.round(t), worldX: Math.round(worldX), jumpY: jump.y.toFixed(1), obstacle: o });
    }
    worldX += scrollSpeedPxMs * STEP_MS / 1000;
    obstacles.update(t, worldX, scrollSpeedPxMs);
  }

  const collidingHeights = [...new Set(
    obstacles.candidates.filter((c) => c.colliding).map((c) => c.height),
  )];
  return {
    collisions,
    candidateCount: obstacles.candidates.length,
    spawnedCount: obstacles.active.length,
    collidingHeights,
  };
}

test('coveredWindows produces a window per launch kick for a simple kick track', () => {
  const kicks = [];
  for (let i = 0; i < 6; i++) kicks.push({ tMs: i * 1000, vel: 0.75 });
  const windows = JumpPlanner.coveredWindows(kicks, { obstacleHeight: 46 });
  assert.ok(windows.length >= 5, `expected >=5 windows, got ${windows.length}`);
  for (const w of windows) {
    assert.ok(w.mid50[1] > w.mid50[0], 'mid50 must be a nonempty interval');
    assert.ok(w.exitMs > w.enterMs, 'covered interval must be nonempty');
  }
});

test('zero unavoidable collisions across seeded demo timelines (bpm <= 150, no ghost kicks)', () => {
  for (const bpm of [90, 120, 150]) {
    for (const seed of [1, 1337, 42, 2024, 7]) {
      const { collisions, candidateCount } = runTimeline({ bpm, seed, bars: 48 });
      assert.equal(collisions.length, 0,
        `bpm=${bpm} seed=${seed}: ${collisions.length} unavoidable collisions, candidateCount=${candidateCount}\n` +
        JSON.stringify(collisions.slice(0, 5)));
    }
  }
});

test('zero colliding-terrace stumbles at 180 BPM with half-time ghost kicks', () => {
  for (const seed of [1, 42, 1337]) {
    const { collisions, candidateCount } = runTimeline({ bpm: 180, seed, bars: 48 });
    assert.equal(collisions.length, 0,
      `bpm=180 seed=${seed}: ${collisions.length} collisions, candidateCount=${candidateCount}`);
  }
});

test('GroundField harness: terrain-aware clearance stays collision-free', () => {
  for (const seed of [1, 7, 2024]) {
    const { collisions } = runTimeline({ bpm: 120, seed, bars: 48, useGround: true });
    assert.equal(collisions.length, 0, `seed=${seed}: ground-aware collisions=${collisions.length}`);
  }
});

test('variable terrace heights stay within quantized tiers', () => {
  const { collidingHeights, candidateCount } = runTimeline({ bpm: 120, seed: 1337, bars: 64 });
  assert.ok(candidateCount > 0);
  assert.ok(collidingHeights.length >= 1);
  for (const h of collidingHeights) {
    assert.ok(JumpPlanner.HEIGHT_TIERS.includes(h), `unexpected height tier ${h}`);
  }
});

test('minClearanceH floors H so the plateau clears the obstacle', () => {
  const H = JumpPlanner.minClearanceH(46);
  const Ha = (1 - 0.08) * H;
  assert.ok(Ha >= 46 + JumpPlanner.CLEAR_MARGIN, `Ha=${Ha.toFixed(1)} should clear 46+margin`);
});

test('colliding terraces are only placed when a covered window exists', () => {
  const kicks = [{ tMs: 0, vel: 0.2 }, { tMs: 400, vel: 0.2 }];
  const windows = JumpPlanner.coveredWindows(kicks, { obstacleHeight: 72, jumpHeight: 0.25 });
  assert.equal(windows.length, 0, 'low jumpHeight must not clear tallest tier');
});