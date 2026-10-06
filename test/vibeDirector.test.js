import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VibeDirector } from '../src/sim/VibeDirector.js';
import { meltMesh } from '../src/render/MeshDrawer.js';
import { radialMesh } from '../src/render/meshes.js';
import { Role } from '../src/core/NoteEvent.js';

const STEP = 1 / 120;

// Note-based tonal reading only trusts authored pitches (isAuthoredPitch),
// so these fixtures are what they always stood for: MIDI.
function loopedTimeline(pitches, gapMs, reps, vel = 0.7, extra = { src: 'midi', pitchProvenance: 'authored' }) {
  const out = [];
  for (let r = 0; r < reps; r++) {
    pitches.forEach((p, i) => out.push({ tMs: (r * pitches.length + i) * gapMs, pitch: p, vel, role: Role.MELODY, ...extra }));
  }
  return out;
}

function runVibe(timeline, seconds, energy = null) {
  const vibe = new VibeDirector(timeline);
  const curves = energy == null ? null
    : { globalEnergy: () => energy, globalEnergyNorm: () => energy, sample: () => energy * 0.5 };
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

test('a looping C arpeggio settles the exposed tonic at pitch-class 0 with real confidence', () => {
  const v = runVibe(loopedTimeline([60, 64, 67, 72], 250, 40), 8);
  assert.equal(v.tonic, 0);
  assert.ok(v.tonicConfidence > 0.3, `expected real confidence, got ${v.tonicConfidence.toFixed(2)}`);
});

test('a looping G arpeggio settles the exposed tonic at pitch-class 7', () => {
  const v = runVibe(loopedTimeline([67, 71, 74, 79], 250, 40), 8);
  assert.equal(v.tonic, 7);
});

test('tonic/tonicConfidence hold their defaults when there is not yet enough evidence (count<3)', () => {
  const vibe = new VibeDirector([{ tMs: 0, pitch: 60, vel: 0.7, role: Role.MELODY }]);
  vibe.update(0, STEP, null);
  assert.equal(vibe.tonic, 0);
  assert.equal(vibe.tonicConfidence, 0);
});

test('a confident spectral key timeline takes precedence over a misleading note-event argmax', () => {
  // Raw-audio pitch events are sparse/onset-biased; they can over-count one
  // melodic note even while the spectral chroma correctly hears the harmony.
  const notes = loopedTimeline([62, 62, 62, 62], 200, 8);
  const vibe = new VibeDirector(notes, [
    { tMs: 0, tonic: 0, mode: 'major', majorness: 0.8, confidence: 0.9 },
  ]);
  vibe.update(1000, STEP, null);
  assert.equal(vibe.tonic, 0);
  assert.ok(vibe.tonicConfidence > 0.8);
  assert.ok(vibe.valence > 0, 'the timeline major third balance should inform valence');
});

test('dense, loud, wide-register writing reads epic; sparse quiet writing reads trivial', () => {
  const epicNotes = loopedTimeline([36, 48, 60, 72, 84, 96], 120, 80);
  const trivialNotes = loopedTimeline([60, 62], 1800, 6, 0.3);
  const epic = runVibe(epicNotes, 8, 0.9);
  const trivial = runVibe(trivialNotes, 8, 0.1);
  assert.ok(epic.epic > 0.6, `expected epic, got ${epic.epic.toFixed(2)}`);
  assert.ok(trivial.epic < 0.35, `expected trivial, got ${trivial.epic.toFixed(2)}`);
});

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

// --- Pitch provenance (F04) -----------------------------------------------------
//
// What a recording's note events look like: AudioAdapter gives a band's
// note an INFERRED pitch with zero confidence when the tracker heard nothing
// usable, and chord pads SYNTHETIC pitches. Activity, not harmony.
const inferred = (tMs, pitch, vel) => ({
  tMs, pitch, vel, role: Role.MELODY, src: 'audio', channel: 0, pitchProvenance: 'inferred', pitchConfidence: 0,
});

/** The audit reproduction: twelve placeholder pitches, every pitch class,
 *  uneven velocities, zero confidence, looped. */
function twelvePlaceholders(seconds = 30) {
  const out = [];
  const vels = [0.9, 0.2, 0.6, 0.3, 0.85, 0.5, 0.25, 0.8, 0.35, 0.55, 0.3, 0.45];
  for (let t = 0, i = 0; t < seconds * 1000; t += 125, i++) out.push(inferred(t, 48 + (i % 12) * 3, vels[i % 12]));
  return out;
}

function stepVibe(vibe, fromMs, toMs, curves = null, keys = null) {
  const trace = [];
  for (let t = fromMs; t <= toMs; t += 8.33) {
    vibe.update(t, STEP, curves);
    if (keys) {
      keys.update(t, STEP, { tonic: vibe.tonic, tonicConfidence: vibe.tonicConfidence });
      if (keys.justKeyChange) trace.push(t);
    }
  }
  return trace;
}

test('zero-confidence inferred pitches invent no key, no third and no key change', async () => {
  const { KeyDirector } = await import('../src/sim/KeyDirector.js');
  const vibe = new VibeDirector(twelvePlaceholders(30));
  const keys = new KeyDirector();
  let maxConfidence = 0;
  for (let t = 0; t <= 30000; t += 8.33) {
    vibe.update(t, STEP, null);
    keys.update(t, STEP, { tonic: vibe.tonic, tonicConfidence: vibe.tonicConfidence });
    maxConfidence = Math.max(maxConfidence, vibe.tonicConfidence);
    assert.equal(keys.justKeyChange, false, `no key change at ${t.toFixed(0)}ms`);
  }
  assert.equal(maxConfidence, 0, 'no tonal confidence from placeholder pitches');
  assert.equal(vibe.tonalSource, 'unknown');
  assert.ok(Math.abs(vibe.valence) < 1e-9, `no major/minor tilt without a key, got ${vibe.valence}`);
});

test('placeholder pitches still count as activity for epic', () => {
  const curves = { globalEnergyNorm: () => 0.5, sample: () => 0.25 };
  const busy = new VibeDirector(twelvePlaceholders(10));
  const empty = new VibeDirector([]);
  stepVibe(busy, 0, 8000, curves);
  stepVibe(empty, 0, 8000, curves);
  assert.ok(busy.epic > empty.epic + 0.1, `dense activity must still lift epic: ${busy.epic.toFixed(3)} vs ${empty.epic.toFixed(3)}`);
});

test('placeholder pitches claim no register span, tracked pitches do', () => {
  const curves = { globalEnergyNorm: () => 0.5, sample: () => 0.25 };
  const wide = (provenance, pitchConfidence) => {
    const out = [];
    for (let t = 0, i = 0; t < 10000; t += 125, i++) {
      out.push({ ...inferred(t, i % 2 ? 36 : 84, 0.6), pitchProvenance: provenance, pitchConfidence });
    }
    return out;
  };
  const placeholders = new VibeDirector(wide('inferred', 0));
  const synthetic = new VibeDirector(wide('synthetic', 0));
  const tracked = new VibeDirector(wide('tracked', 0.8));
  for (const v of [placeholders, synthetic, tracked]) stepVibe(v, 0, 8000, curves);
  assert.ok(tracked.epic > placeholders.epic + 0.15, 'a measured four-octave span reads wider');
  assert.ok(Math.abs(placeholders.epic - synthetic.epic) < 1e-9);
  // Tracked pitches are measured, but a key needs authored evidence or a
  // confident chroma timeline.
  assert.equal(tracked.tonicConfidence, 0);
});

test('legacy authored fixtures (no src, a GM program) still read their key', () => {
  const legacy = loopedTimeline([67, 71, 74, 79], 250, 40, 0.7, { program: 0 });
  const v = runVibe(legacy, 8);
  assert.equal(v.tonic, 7);
  assert.equal(v.tonalSource, 'notes');
  assert.ok(v.tonicConfidence > 0.3);
});

test('a confident chroma timeline still sets the key for a recording full of placeholders', () => {
  const vibe = new VibeDirector(twelvePlaceholders(10), [
    { tMs: 0, tonic: 9, mode: 'minor', majorness: -0.7, confidence: 0.8 },
  ]);
  stepVibe(vibe, 0, 4000);
  assert.equal(vibe.tonic, 9);
  assert.equal(vibe.tonalSource, 'spectral');
  assert.ok(vibe.valence < -0.2, 'the chroma third balance drives valence');
});

test('when chroma confidence drops, placeholders do not take over the key', () => {
  const vibe = new VibeDirector(twelvePlaceholders(20), [
    { tMs: 0, tonic: 9, mode: 'minor', majorness: -0.7, confidence: 0.8 },
    { tMs: 6000, tonic: 0, mode: 'major', majorness: 0, confidence: 0.05 },
  ]);
  stepVibe(vibe, 0, 5000);
  const held = { tonic: vibe.tonic, confidence: vibe.tonicConfidence };
  stepVibe(vibe, 5008, 16000);
  assert.equal(vibe.tonic, held.tonic, 'the last confident key is held, not replaced by the 0 default or by noise');
  assert.equal(vibe.tonicConfidence, held.confidence);
  assert.equal(vibe.tonalSource, 'spectral');
});

test('an unknown opening window is not read as C major', () => {
  const vibe = new VibeDirector(twelvePlaceholders(5), [
    { tMs: 0, tonic: 0, mode: 'major', majorness: 0.9, confidence: 0.05 }, // below the gate
  ]);
  stepVibe(vibe, 0, 4000);
  assert.equal(vibe.tonicConfidence, 0);
  assert.equal(vibe.tonalSource, 'unknown');
  assert.ok(Math.abs(vibe.valence) < 1e-9, 'an unconfident major claim adds no happiness');
});
