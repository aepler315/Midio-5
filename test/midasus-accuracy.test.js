// Midasus score-fidelity contract: forward-sim only, each melody onset should
// land within tolerance of its latched target shortly after trigger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Midasus } from '../src/sim/Midasus.js';
import { Conductor } from '../src/core/Conductor.js';
import { buildDemoTimeline } from '../src/core/DemoTimeline.js';
import { Role } from '../src/core/NoteEvent.js';

const STEP_MS = 1000 / 120;
const TOL_X = 25;
const TOL_Y = 18;
const SAMPLE_OFFSET_MS = 40;
const HIT_RATE = 0.90;

test('Midasus hits 90% of melody targets within tolerance at tMs+40ms', () => {
  const data = buildDemoTimeline({ bpm: 120, seed: 1337 });
  const conductor = new Conductor();
  conductor.load(data);

  const midio = { screenX: 200, groundY: 480, y: 0 };
  const m = new Midasus(conductor, midio, { groundY: 480, ceilingY: 40, worldScale: 1 });

  const melody = data.timeline.filter((e) => e.role === Role.MELODY);
  assert.ok(melody.length > 0, 'demo timeline must contain melody notes');

  let hits = 0;
  let t = 0;

  for (const note of melody) {
    const sampleMs = note.tMs + SAMPLE_OFFSET_MS;
    while (t < sampleMs) {
      const step = Math.min(STEP_MS, sampleMs - t);
      const prevT = t;
      t += step;
      conductor.dispatchUpTo(t);
      m.update(t, (t - prevT) / 1000);
    }

    const target = m.targetFor(note);
    const dx = Math.abs(m.p.x - target.x);
    const dy = Math.abs(m.p.y - target.y);
    if (dx <= TOL_X && dy <= TOL_Y) hits++;
  }

  const rate = hits / melody.length;
  assert.ok(
    rate >= HIT_RATE,
    `expected >=${HIT_RATE * 100}% within ±${TOL_X}px X / ±${TOL_Y}px Y, got ${(rate * 100).toFixed(1)}% (${hits}/${melody.length})`,
  );
});