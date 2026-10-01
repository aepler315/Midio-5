import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualMusicHistory } from '../src/world/VisualMusicHistory.js';
import { Role } from '../src/core/NoteEvent.js';
import { rangeMusicState, GUST_IDLE_SEC } from '../src/world/alpine/RangeFrame.js';
import { TREE_COMMON } from '../src/world/alpine/ForestGL.js';

test('the history keeps the kick before the latest, whose front may still be crossing', () => {
  const h = new VisualMusicHistory([
    { role: Role.RHYTHM, tMs: 1000, kick: true, vel: 1 },
    { role: Role.RHYTHM, tMs: 1200, kick: false, vel: 1 },
    { role: Role.RHYTHM, tMs: 1500, kick: true, vel: 0 },
  ]);
  assert.deepEqual([h.sample(900).kickMs, h.sample(900).prevKickMs], [-Infinity, -Infinity]);
  const one = h.sample(1300);
  assert.deepEqual([one.kickMs, one.kickAmp, one.prevKickMs, one.prevKickAmp], [1000, 1, -Infinity, 0]);
  const two = h.sample(1600);
  assert.deepEqual([two.kickMs, two.kickAmp, two.prevKickMs, two.prevKickAmp], [1500, .4, 1000, 1]);
});

test('each kick sends a gust front, aged in heard time', () => {
  const m = rangeMusicState({ env: { kickMul: 1 }, activity01: 1, kickAgeMs: 250, kickAmp: 1, prevKickAgeMs: 750, prevKickAmp: .5 });
  assert.deepEqual(m.gusts, [{ ageSec: .25, amp01: 1 }, { ageSec: .75, amp01: .5 }]);
  const quiet = rangeMusicState({});
  assert.ok(quiet.gusts.every(g => g.ageSec === GUST_IDLE_SEC && g.amp01 === 0), 'no kick, no front in flight');
});

test('reduced motion stills the gusts', () => {
  const m = rangeMusicState({ env: { kickMul: 1 }, activity01: 1, kickAgeMs: 250, kickAmp: 1, reducedMotion: true });
  assert.ok(m.gusts.every(g => g.amp01 === 0));
});

test('the front crosses the frame the way the section\'s wave leans', () => {
  assert.equal(rangeMusicState({ motif: { angle: .3 } }).gustDir, 1);
  assert.equal(rangeMusicState({ motif: { angle: -.3 } }).gustDir, -1);
});

test('the shader\'s gust envelope rises fast, settles, and is silent before the front', () => {
  const body = TREE_COMMON.match(/float gustEnv\(float age, float decay\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(body, 'the forest shader exposes its gust envelope');
  const env = new Function('age', 'decay', body[1].replace(/\bexp\(/g, 'Math.exp('));
  assert.equal(env(-0.01, .4), 0);
  assert.equal(env(0, .4), 0);
  assert.equal(env(.08, .4), 1);
  assert.ok(Math.abs(env(.48, .4) - Math.exp(-1)) < 1e-9);
  assert.ok(env(.48, .12) < env(.48, .4), 'the sheen passes faster than the lean');
});
