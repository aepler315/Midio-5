import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broshi } from '../src/sim/Broshi.js';
import { Role } from '../src/core/NoteEvent.js';

function fakeConductor() {
  const barHandlers = [];
  const roleHandlers = {};
  const aheadHandlers = {};
  return {
    onBar(fn) { barHandlers.push(fn); },
    on(role, fn) { (roleHandlers[role] ||= []).push(fn); },
    // Anticipation channel (ChoreoClock): the fake delivers immediately --
    // lead time is a dispatch detail these tests don't exercise.
    subscribeAhead(role, leadMs, fn) { (aheadHandlers[role] ||= []).push(fn); },
    fireBar(ms) { for (const fn of barHandlers) fn({ ms }); },
    fireEvent(role, evt) {
      const e = { role, ...evt }; // real NoteEvents always carry their role
      for (const fn of (aheadHandlers[role] || [])) fn(e);
      for (const fn of (aheadHandlers['*'] || [])) fn(e);
      for (const fn of (roleHandlers[role] || [])) fn(e);
    },
  };
}

function fakeMidio() { return { screenX: 200 }; }

test('tail sway widens under sustained calm compared to energetic', () => {
  const conductorA = fakeConductor();
  const a = new Broshi(conductorA, {}, { seed: 1 });
  const conductorB = fakeConductor();
  const b = new Broshi(conductorB, {}, { seed: 1 }); // same seed -> same tail phase

  let maxA = 0, maxB = 0;
  for (let i = 0; i < 400; i++) {
    const t = i * 20;
    a.update(t, 1 / 60, fakeMidio(), null, null, 0, 480, 0);
    b.update(t, 1 / 60, fakeMidio(), null, null, 0, 480, 1);
    maxA = Math.max(maxA, Math.abs(a.tailAngle));
    maxB = Math.max(maxB, Math.abs(b.tailAngle));
  }
  assert.ok(maxB > maxA, `expected calm tail sway (${maxB}) to be wider than energetic (${maxA})`);
});

test('mini-hop height is softened during calm ("relaxed lope")', () => {
  const conductorA = fakeConductor();
  const a = new Broshi(conductorA, {}, { seed: 2 });
  const conductorB = fakeConductor();
  const b = new Broshi(conductorB, {}, { seed: 2 });

  conductorA.fireEvent(Role.MELODY, { kick: false, vel: 0.8, pitch: 64 });
  conductorB.fireEvent(Role.MELODY, { kick: false, vel: 0.8, pitch: 64 });
  a.update(0, 1 / 60, fakeMidio(), null, null, 0, 480, 0);
  b.update(0, 1 / 60, fakeMidio(), null, null, 0, 480, 1);

  let peakA = 0, peakB = 0;
  for (let t = 10; t <= 170; t += 10) {
    a.update(t, 1 / 60, fakeMidio(), null, null, 0, 480, 0);
    b.update(t, 1 / 60, fakeMidio(), null, null, 0, 480, 1);
    peakA = Math.max(peakA, a.hopY);
    peakB = Math.max(peakB, b.hopY);
  }
  assert.ok(peakA > 0, 'expected a non-trivial hop at full energy');
  assert.ok(peakB < peakA, `expected calm hop (${peakB}) to be softer than energetic (${peakA})`);
});

test('a sustained calm streak eventually triggers a yawn (slow jaw open, not the fast kick-snap)', () => {
  const conductor = fakeConductor();
  const broshi = new Broshi(conductor, {}, { seed: 3 });
  let t = 0;
  let sawYawn = false;
  for (let bar = 0; bar < 60 && !sawYawn; bar++) {
    broshi.update(t, 1 / 60, fakeMidio(), null, null, 0, 480, 1);
    conductor.fireBar(t);
    // Sample jawOpen across the bar for a slow (not instantaneous) rise typical of a yawn.
    for (let i = 1; i <= 20; i++) {
      const sampleT = t + i * 20;
      broshi.update(sampleT, 1 / 60, fakeMidio(), null, null, 0, 480, 1);
      if (broshi.jawOpen > 0.3) { sawYawn = true; break; }
    }
    t += 500;
  }
  assert.ok(sawYawn, 'expected a yawn to eventually trigger under a long sustained calm streak');
});

test('apex-on-beat: the hop peak lands exactly on the triggering note\'s tMs', () => {
  const conductor = fakeConductor();
  const b = new Broshi(conductor, {}, { seed: 7 });
  // The anticipation channel delivers the note early with its true onset.
  conductor.fireEvent(Role.MELODY, { vel: 0.8, pitch: 64, tMs: 1000 });
  let peakT = null, peak = -1;
  for (let t = 800; t <= 1200; t += 4) {
    b.update(t, 1 / 240, fakeMidio(), null, null, 0, 480, 0);
    if (b.hopY > peak) { peak = b.hopY; peakT = t; }
  }
  assert.ok(peak > 0, 'the hop must fire');
  assert.ok(Math.abs(peakT - 1000) <= 8, `apex must land ON the note (got peak at ${peakT})`);
});

test('output latency shifts the hop apex onto the HEARD beat', () => {
  const conductor = fakeConductor();
  const b = new Broshi(conductor, {}, { seed: 7 });
  b.visualLagMs = 120;
  conductor.fireEvent(Role.MELODY, { vel: 0.8, pitch: 64, tMs: 1000 });
  let peakT = null, peak = -1;
  for (let t = 800; t <= 1400; t += 4) {
    b.update(t, 1 / 240, fakeMidio(), null, null, 0, 480, 0);
    if (b.hopY > peak) { peak = b.hopY; peakT = t; }
  }
  assert.ok(Math.abs(peakT - 1120) <= 8, `with 120ms output lag the apex waits for the ear (got ${peakT})`);
});

test('casting: a hopFilter routes his body to HIS lane only', () => {
  const conductor = fakeConductor();
  const b = new Broshi(conductor, {}, { seed: 8, hopFilter: (e) => e.lane === 'BROSHI' });
  // A melody note that is NOT his lane: head may bob, body must not hop.
  conductor.fireEvent(Role.MELODY, { vel: 0.9, pitch: 70, tMs: 500, lane: 'MIDASUS' });
  let hopped = 0;
  for (let t = 300; t <= 700; t += 10) {
    b.update(t, 1 / 100, fakeMidio(), null, null, 0, 480, 0);
    if (b.hopY > 0) hopped++;
  }
  assert.equal(hopped, 0, 'not his line, no hop');
  // His bass lane note: the hop fires (and learns the bass register).
  conductor.fireEvent(Role.BASS, { vel: 0.9, pitch: 38, tMs: 1000, lane: 'BROSHI' });
  let peak = 0;
  for (let t = 850; t <= 1150; t += 10) {
    b.update(t, 1 / 100, fakeMidio(), null, null, 0, 480, 0);
    peak = Math.max(peak, b.hopY);
  }
  assert.ok(peak > 0, 'his bass line hops him');
});

test('lost traction (snow) makes the trailing spring visibly overshoot more', () => {
  const run = (traction) => {
    const conductor = fakeConductor();
    const b = new Broshi(conductor, {}, { seed: 9 });
    b.traction = traction;
    b.xRel = -300; // displaced hard from the trail point
    let overshoot = 0;
    for (let t = 0; t <= 6000; t += 16) {
      b.update(t, 16 / 1000, fakeMidio(), null, null, 0, 480, 0);
      overshoot = Math.max(overshoot, b.xRel - b._trailTarget);
    }
    return overshoot;
  };
  const icy = run(0.3), dry = run(1);
  assert.ok(icy > dry + 5, `icy overshoot (${icy}) must exceed dry (${dry})`);
});
