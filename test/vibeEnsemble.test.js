import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VibeDirector } from '../src/sim/VibeDirector.js';
import { EnsembleDirector } from '../src/sim/EnsembleDirector.js';
import { meltMesh } from '../src/render/MeshDrawer.js';
import { radialMesh } from '../src/render/meshes.js';
import { Role } from '../src/core/NoteEvent.js';

const STEP = 1 / 120;

function loopedTimeline(pitches, gapMs, reps, vel = 0.7) {
  const out = [];
  for (let r = 0; r < reps; r++) {
    pitches.forEach((p, i) => out.push({ tMs: (r * pitches.length + i) * gapMs, pitch: p, vel, role: Role.MELODY }));
  }
  return out;
}

function runVibe(timeline, seconds, energy = null) {
  const vibe = new VibeDirector(timeline);
  const curves = energy == null ? null : { globalEnergy: () => energy, sample: () => energy * 0.5 };
  let t = 0;
  for (let i = 0; i < seconds * 120; i++) { vibe.update(t, STEP, curves); t += 8.33; }
  return vibe;
}

test('a looping major arpeggio reads happy; the minor version reads sad', () => {
  const major = runVibe(loopedTimeline([60, 64, 67, 72], 250, 40), 8);
  const minor = runVibe(loopedTimeline([60, 63, 67, 72], 250, 40), 8);
  assert.ok(major.valence > 0.15, `major should read happy, got ${major.valence.toFixed(2)}`);
  assert.ok(minor.valence < -0.05, `minor should read sad, got ${minor.valence.toFixed(2)}`);
  assert.ok(major.valence > minor.valence + 0.3, 'the two modes must clearly separate');
});

test('dense, loud, wide-register writing reads epic; sparse quiet writing reads trivial', () => {
  const epicNotes = loopedTimeline([36, 48, 60, 72, 84, 96], 120, 80);
  const trivialNotes = loopedTimeline([60, 62], 1800, 6, 0.3);
  const epic = runVibe(epicNotes, 8, 0.9);
  const trivial = runVibe(trivialNotes, 8, 0.1);
  assert.ok(epic.epic > 0.6, `expected epic, got ${epic.epic.toFixed(2)}`);
  assert.ok(trivial.epic < 0.35, `expected trivial, got ${trivial.epic.toFixed(2)}`);
});

function runEnsemble(valence, epic, seconds) {
  const ens = new EnsembleDirector(7);
  const vibe = { valence, epic };
  let t = 0;
  const rTrace = [];
  for (let i = 0; i < seconds * 120; i++) {
    ens.update(t, STEP, vibe, 500);
    t += 8.33;
    if (i % 12 === 0) rTrace.push(ens.r);
  }
  return { ens, rTrace };
}

test('happy + epic locks the trio in harmony: high order, tight formation', () => {
  const { ens } = runEnsemble(0.8, 0.9, 20);
  assert.ok(ens.rSmooth > 0.85, `expected phase lock, got r=${ens.rSmooth.toFixed(2)}`);
  assert.ok(ens.spread < 260, `expected a tight formation, got spread=${ens.spread.toFixed(0)}`);
});

test('sadness kills the coupling: the trio drifts apart, out of step', () => {
  const { ens } = runEnsemble(-0.8, 0.2, 25);
  assert.ok(ens.rSmooth < 0.72, `expected weak order, got r=${ens.rSmooth.toFixed(2)}`);
  assert.ok(ens.spread > 330, `expected a wide drift, got spread=${ens.spread.toFixed(0)}`);
});

test('neutral vibe sits near the critical boundary: they try to sync and keep slipping', () => {
  const { rTrace } = runEnsemble(0.05, 0.25, 40);
  const later = rTrace.slice(Math.floor(rTrace.length / 3));
  const rMax = Math.max(...later), rMin = Math.min(...later);
  // Genuine slip cycles: order repeatedly climbs and collapses.
  assert.ok(rMax > 0.7, `should nearly lock at times, peak r=${rMax.toFixed(2)}`);
  assert.ok(rMin < 0.45, `should collapse at times, min r=${rMin.toFixed(2)}`);
});

test('ensemble anchors stay inside their stage-safety windows', () => {
  for (const [v, e] of [[0.9, 0.9], [-0.9, 0.1], [0, 0.4]]) {
    const { ens } = runEnsemble(v, e, 15);
    assert.ok(ens.anchors[0].x >= 1280 * 0.12 - 1 && ens.anchors[0].x <= 1280 * 0.62 + 1, 'Midio window');
    assert.ok(ens.anchors[2].y > 0 && ens.anchors[2].y < 720 * 0.75, 'Midasus altitude');
  }
});

test('setPresence eases a weight toward its target rather than snapping', () => {
  const { ens } = runEnsemble(0.5, 0.5, 2);
  ens.setPresence(2, 0);
  const before = ens.weights[2];
  ens.update(0, STEP, { valence: 0.5, epic: 0.5 }, 500);
  assert.ok(ens.weights[2] < before, 'weight should start easing down');
  assert.ok(ens.weights[2] > 0.001, 'a single 8ms step must not reach 0 instantly');
});

test('an absent oscillator free-runs on its own detune, ignoring the group', () => {
  const ens = new EnsembleDirector(7);
  const vibe = { valence: 0.9, epic: 0.9 }; // strong coupling if it were present
  let t = 0;
  ens.setPresence(2, 0);
  // Let the weight actually reach ~0 before measuring free-run behavior.
  for (let i = 0; i < 6 * 120; i++) { ens.update(t, STEP, vibe, 500); t += 8.33; }
  assert.ok(ens.weights[2] < 0.02, `weight should have eased to ~0, got ${ens.weights[2].toFixed(3)}`);

  const omega0 = TWO_PI_FOR_TEST(500);
  const expectedRate = omega0 + 0.9; // DETUNES[2] (Midasus) with no coupling term
  const theta0 = ens.theta[2];
  ens.update(t, STEP, vibe, 500);
  const dTheta = wrapDelta(ens.theta[2] - theta0);
  assert.ok(Math.abs(dTheta / STEP - expectedRate) < 0.05, `expected free-run rate ${expectedRate}, got ${dTheta / STEP}`);
});

test('a duo can still fully lock while the third performer is away', () => {
  const ens = new EnsembleDirector(7);
  const vibe = { valence: 0.9, epic: 0.9 };
  let t = 0;
  ens.setPresence(2, 0);
  for (let i = 0; i < 20 * 120; i++) { ens.update(t, STEP, vibe, 500); t += 8.33; }
  assert.ok(ens.rSmooth > 0.85, `duo should still lock tightly, got r=${ens.rSmooth.toFixed(2)}`);
});

test('presence weight returning to 1 lets the trio re-sync (no permanent damage)', () => {
  const ens = new EnsembleDirector(7);
  const vibe = { valence: 0.9, epic: 0.9 };
  let t = 0;
  ens.setPresence(1, 0);
  for (let i = 0; i < 15 * 120; i++) { ens.update(t, STEP, vibe, 500); t += 8.33; }
  ens.setPresence(1, 1);
  for (let i = 0; i < 20 * 120; i++) { ens.update(t, STEP, vibe, 500); t += 8.33; }
  assert.ok(ens.weights[1] > 0.98, 'weight should have fully returned');
  assert.ok(ens.rSmooth > 0.85, `full trio should re-lock after the return, got r=${ens.rSmooth.toFixed(2)}`);
});

function TWO_PI_FOR_TEST(beatPeriodMs) { return (Math.PI * 2) / (beatPeriodMs / 1000); }
function wrapDelta(d) {
  const TWO_PI = Math.PI * 2;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

test('meltMesh flows every rim vertex, holds the hub, and stays bounded', () => {
  const mesh = radialMesh(20, 20, 8, 0, -20);
  const melted = meltMesh(mesh, 0, -20, 3.7, 5, 1);
  assert.notEqual(melted, mesh);
  assert.deepEqual(melted.vertices[0], mesh.vertices[0], 'the hub must hold still');
  let moved = 0;
  for (let i = 1; i < mesh.vertices.length; i++) {
    const d = Math.hypot(melted.vertices[i].x - mesh.vertices[i].x, melted.vertices[i].y - mesh.vertices[i].y);
    assert.ok(d < 5 * 8, `vertex ${i} melted too far: ${d}`);
    if (d > 0.3) moved++;
  }
  assert.ok(moved >= 5, `most rim vertices should be in flow, only ${moved} moved`);
  // Time-varying: the same call at another instant gives a different pose.
  const melted2 = meltMesh(mesh, 0, -20, 4.9, 5, 1);
  const delta = Math.hypot(
    melted2.vertices[1].x - melted.vertices[1].x,
    melted2.vertices[1].y - melted.vertices[1].y,
  );
  assert.ok(delta > 0.05, 'the melt must keep flowing over time');
  // Zero melt is the identity.
  assert.equal(meltMesh(mesh, 0, -20, 3.7, 0, 1), mesh);
});
