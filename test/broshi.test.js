import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broshi } from '../src/sim/Broshi.js';
import { Role } from '../src/core/NoteEvent.js';

function fakeConductor() {
  const barHandlers = [];
  const roleHandlers = {};
  return {
    onBar(fn) { barHandlers.push(fn); },
    on(role, fn) { (roleHandlers[role] ||= []).push(fn); },
    fireBar(ms) { for (const fn of barHandlers) fn({ ms }); },
    fireEvent(role, evt) { for (const fn of (roleHandlers[role] || [])) fn(evt); },
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

  conductorA.fireEvent(Role.RHYTHM, { kick: false, vel: 0.8 });
  conductorB.fireEvent(Role.RHYTHM, { kick: false, vel: 0.8 });
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
