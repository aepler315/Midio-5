// Item 4 — the obstacle⇄jump contract. Drives the gameplay subsystems
// (Conductor + ParamBus + JumpController + ObstacleSpawner) deterministically
// over seeded demo timelines and asserts zero unavoidable collisions: every
// placed obstacle must arrive under a covered arc. No BiomeManager (which
// needs a canvas), so this runs in `npm test` alongside the other node tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { JumpController } from '../src/sim/JumpController.js';
import { ObstacleSpawner } from '../src/sim/ObstacleSpawner.js';
import { buildDemoTimeline } from '../src/core/DemoTimeline.js';
import { Role } from '../src/core/NoteEvent.js';
import * as JumpPlanner from '../src/sim/JumpPlanner.js';

const STEP_MS = 1000 / 120;
const WORLD_SPEED_PX_S = 220;
const HALF_WIDTH = 23; // Midio.halfWidth

// Replay Simulation.step's gameplay slice without the canvas-bound world
// systems, returning every collision (which the contract says should be none).
function runTimeline({ bpm, seed, bars = 48, jumpHeight = 1, obstacleDensity = 1 }) {
  const conductor = new Conductor();
  const paramBus = new ParamBus();
  // Pin live params so the test is deterministic (no smoothing drift).
  paramBus.live.jumpHeight = jumpHeight;
  paramBus.live.obstacleDensity = obstacleDensity;
  paramBus.live.scrollSpeed = 1;

  const data = buildDemoTimeline({ bpm, bars, seed });
  conductor.load(data);

  const obstacles = new ObstacleSpawner(paramBus);
  obstacles.buildCandidates(conductor.timeline, 60000 / bpm);

  const jump = new JumpController(paramBus);

  // Mirror Simulation's kick subscription: pass the nearest upcoming obstacle
  // so the accommodation side can floor H for clearance.
  conductor.on(Role.RHYTHM, (evt) => {
    if (evt.kick) jump.onKick(evt, conductorTime, obstacles.nearestAhead(worldX));
  });

  let worldX = 0;
  let conductorTime = 0;
  const collisions = [];

  for (let t = STEP_MS; t <= data.durationMs + 1000; t += STEP_MS) {
    conductorTime = t;
    jump.clearFrameFlags();
    conductor.dispatchUpTo(t);
    jump.update(t);

    const scrollSpeedPxMs = (WORLD_SPEED_PX_S * paramBus.live.scrollSpeed) / 1000;
    // Collision check at the current worldX (advanced last step), matching
    // Simulation.step which checks before advancing worldX.
    const stumbled = obstacles.checkCollision(worldX, HALF_WIDTH, jump.y);
    if (stumbled) {
      const o = obstacles.active.find((x) => x.passed);
      collisions.push({ t: Math.round(t), worldX: Math.round(worldX), jumpY: jump.y.toFixed(1), obstacle: o });
    }
    worldX += scrollSpeedPxMs * STEP_MS / 1000;
    obstacles.update(t, worldX, scrollSpeedPxMs);
  }

  return { collisions, candidateCount: obstacles.candidates.length, spawnedCount: obstacles.active.length };
}

test('coveredWindows produces a window per launch kick for a simple kick track', () => {
  // Kicks every 1000ms, vel 0.75 → every kick launches from GROUND (D<interval
  // after the first short arc), so each kick yields a covered arc.
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

test('minClearanceH floors H so the plateau clears the obstacle', () => {
  const H = JumpPlanner.minClearanceH(46);
  // plateau Ha = (1-W)*H must reach 46 + margin
  const Ha = (1 - 0.08) * H;
  assert.ok(Ha >= 46 + JumpPlanner.CLEAR_MARGIN, `Ha=${Ha.toFixed(1)} should clear 46+margin`);
});

test('no obstacle is placed when no arc could clear it (very tall obstacle)', () => {
  // Obstacle taller than the max possible arc height (H_BASE*1.4) → no window
  // → buildCandidates drops every candidate → zero spawns → zero collisions.
  const conductor = new Conductor();
  const paramBus = new ParamBus();
  const data = buildDemoTimeline({ bpm: 120, bars: 16, seed: 1 });
  conductor.load(data);
  const obstacles = new ObstacleSpawner(paramBus, { height: 9999 });
  obstacles.buildCandidates(conductor.timeline, 500);
  assert.equal(obstacles.candidates.length, 0, 'unclearable obstacle must yield no candidates');
});