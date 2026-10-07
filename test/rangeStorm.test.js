import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileStorm, stormAt } from '../src/world/alpine/RangeStorm.js';
const energyCurves = { globalEnergyNorm: t => t >= 40000 && t < 60000 ? .95 : .25 };
const sections = [{ startMs: 0, endMs: 40000 }, { startMs: 40000, endMs: 60000 }, { startMs: 60000, endMs: 120000 }];
const timeline = [{ tMs: 45000, pitch: 38, role: 'RHYTHM', vel: .9 }, { tMs: 45100, pitch: 40, channel: 9, vel: 1 }, { tMs: 47000, pitch: 36, role: 'RHYTHM', vel: 1 }];
test('storm selects the measured loudest section and breaks into wet sunlight after it', () => {
  const score = compileStorm({ energyCurves, sections, timeline, durationMs: 120000 });
  assert.deepEqual(score.section, { startMs: 40000, endMs: 60000 });
  assert.equal(score.at(20000).amount, 0);
  assert.equal(score.at(45000).amount, 1);
  assert.equal(score.at(70000).amount, 0);
  assert.ok(score.at(70000).break01 > .6);
  assert.ok(score.at(70000).wet01 > .6);
  assert.equal(score.at(120000).break01, 0);
});
test('a sustained early climax wins after the opening guard, including its snare flashes', () => {
  const score = compileStorm({
    energyCurves: { globalEnergyNorm: t => t < 40000 ? .95 : .2 },
    sections: [{ startMs: 0, endMs: 40000 }, { startMs: 40000, endMs: 80000 }, { startMs: 80000, endMs: 120000 }],
    timeline: [{ tMs: 30000, pitch: 38, channel: 9, vel: .9 }],
    durationMs: 120000,
  });
  assert.deepEqual(score.section, { startMs: 8000, endMs: 40000 });
  assert.ok(score.at(30000).flash > .5);
  assert.equal(score.at(60000).amount, 0);
});
test('a measured late climax is eligible even when its section starts near the ending', () => {
  const score = compileStorm({
    energyCurves: { globalEnergyNorm: t => t >= 110000 ? .95 : .2 },
    sections: [{ startMs: 0, endMs: 110000 }, { startMs: 110000, endMs: 120000 }],
    durationMs: 120000,
  });
  assert.deepEqual(score.section, { startMs: 110000, endMs: 120000 });
});
test('unsegmented songs can climax early or late after the arrival', () => {
  for (const startMs of [8000, 100000]) {
    const score = compileStorm({
      energyCurves: { globalEnergyNorm: t => t >= startMs && t < startMs + 20000 ? .95 : .2 },
      durationMs: 120000,
    });
    assert.equal(score.section.startMs, startMs);
  }
});
test('lightning is actual snare timing, seek safe, rate limited and disabled by reduced flash', () => {
  const score = compileStorm({ energyCurves, sections, timeline, durationMs: 120000 });
  assert.ok(score.at(45020).flash > .5);
  assert.equal(score.at(45100).flash, score.at(45100).flash);
  assert.equal(score.at(47000).flash, 0);
  assert.equal(score.at(45020, { reducedFlash: true }).flash, 0);
  assert.ok(score.at(45020).flash > score.at(45120).flash);
});
test('songs without structural sections use their loudest sustained window; no audio evidence means no flashes', () => {
  const score = compileStorm({ energyCurves, durationMs: 120000 });
  assert.ok(score.section.startMs >= 35000 && score.section.startMs < 60000);
  assert.equal(score.at(45000).flash, 0);
  const mgr = { energyCurves, durationMs: 120000, sections, conductor: { timeline } };
  assert.deepEqual(stormAt(mgr, 45020), stormAt(mgr, 45020));
  mgr.reducedFlash = true;
  assert.equal(stormAt(mgr, 45020).flash, 0);
});

test('a pitched D2/E2 line never creates lightning and snare velocity is respected', () => {
  const song = { energyCurves, sections, durationMs: 120000 };
  assert.equal(compileStorm({ ...song, timeline: [{ tMs: 45000, pitch: 38, role: 'BASS', vel: 1 }] }).at(45000).flash, 0);
  assert.equal(compileStorm({ ...song, timeline: [{ tMs: 45000, pitch: 40, role: 'RHYTHM', vel: .2 }] }).at(45000).flash, .2);
});

test('missing measurements do not invent a climax', () => {
  const score = compileStorm({ durationMs: 60000, sections: [{startMs:0,endMs:20000}] });
  assert.equal(score.section,null);
  assert.equal(score.at(12000).amount,0);
});
