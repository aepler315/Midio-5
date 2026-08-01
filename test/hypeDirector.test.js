import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HypeDirector, hypeFrameStyle } from '../src/sim/HypeDirector.js';

function fakeEnergy(value) {
  return { globalEnergy: () => value };
}

const STEP = 1 / 120;

test('a sudden loud attack after a quiet stretch fires exactly one drop', () => {
  const hype = new HypeDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) { hype.update(t, STEP, fakeEnergy(0.1)); t += 8.33; } // 5s quiet
  assert.equal(hype.dropCount, 0);

  for (let i = 0; i < 120; i++) { hype.update(t, STEP, fakeEnergy(0.95)); t += 8.33; } // the drop hits
  assert.equal(hype.dropCount, 1, 'the attack must register as a drop');
  assert.ok(hype.surge > 0.5, 'surge should still be hot right after');
});

test('sustained loud music never re-fires: fast and slow EMAs converge', () => {
  const hype = new HypeDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) { hype.update(t, STEP, fakeEnergy(0.1)); t += 8.33; }
  for (let i = 0; i < 2400; i++) { hype.update(t, STEP, fakeEnergy(0.95)); t += 8.33; } // 20s loud
  assert.equal(hype.dropCount, 1, 'only the initial attack counts, not the sustain');
});

test('the cooldown blocks rapid-fire drops from an oscillating dynamic', () => {
  const hype = new HypeDirector();
  let t = 0;
  // Alternate 1.5s quiet / 1.5s loud for 12s: without a cooldown this would
  // fire every cycle; with it, at most every 6s.
  for (let i = 0; i < 1440; i++) {
    const loud = Math.floor(t / 1500) % 2 === 1;
    hype.update(t, STEP, fakeEnergy(loud ? 0.95 : 0.05));
    t += 8.33;
  }
  assert.ok(hype.dropCount <= 2, `cooldown must cap drops, got ${hype.dropCount}`);
});

test('kick slams spike and decay; surge decays; ring window opens then closes', () => {
  const hype = new HypeDirector();
  hype.onKick(1);
  assert.ok(hype.slam >= 0.9);
  let t = 0;
  for (let i = 0; i < 60; i++) { hype.update(t, STEP, fakeEnergy(0.3)); t += 8.33; } // 0.5s
  assert.ok(hype.slam < 0.05, 'slam must decay within half a second');

  hype.dropAtMs = t;
  assert.ok(hype.ringU(t + 100) > 0 && hype.ringU(t + 100) < 1);
  assert.equal(hype.ringU(t + 2000), null, 'ring must close after its window');
});

test('hypeFrameStyle nearly extinguishes the rim during calm; energetic still reads', () => {
  const hot = { fast: 0.6, slam: 1, surge: 0 };
  const calmHot = hypeFrameStyle(hot, 1);
  const wildHot = hypeFrameStyle(hot, 0);
  assert.ok(calmHot.alpha < 0.08, `calm + kick slam should barely flash the rim, got ${calmHot.alpha}`);
  assert.ok(wildHot.alpha > 0.35, `energetic slam should still light the frame, got ${wildHot.alpha}`);
  assert.ok(calmHot.alpha < wildHot.alpha * 0.25, 'calm must cut most of the kick-strobe');

  const drop = { fast: 0.2, slam: 0, surge: 1 };
  const calmDrop = hypeFrameStyle(drop, 1);
  const wildDrop = hypeFrameStyle(drop, 0);
  assert.ok(calmDrop.alpha > calmHot.alpha, 'a drop surge should still peek through calm more than a kick');
  assert.ok(wildDrop.alpha > calmDrop.alpha, 'full surge is brighter when not calm');
  assert.ok(calmDrop.echo > 0 || wildDrop.echo > 0);

  const idle = hypeFrameStyle({ fast: 0.15, slam: 0, surge: 0 }, 1);
  assert.ok(idle.alpha < 0.03, 'fully calm idle rim should be almost gone');
});
