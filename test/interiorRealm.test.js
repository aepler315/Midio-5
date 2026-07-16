import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InteriorRealm, generateWarren, generateTemple, generateTomb, generateGeode,
} from '../src/world/InteriorRealm.js';

const CANVAS = { width: 1280, height: 720 };

function fakeCtx() {
  const calls = { fill: 0, stroke: 0, save: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    save() { calls.save++; }, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {}, rotate() {}, scale() {}, translate() {},
    fill() { calls.fill++; }, stroke() { calls.stroke++; }, fillRect() {}, strokeRect() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set globalAlpha(_v) {}, set globalCompositeOperation(_v) {},
  };
}

test('generators are DOM-free and deterministic per seed', () => {
  const a = generateWarren(5), b = generateWarren(5);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateWarren(6));

  assert.doesNotThrow(() => generateTemple(5));
  assert.doesNotThrow(() => generateTomb(5));
  assert.doesNotThrow(() => generateGeode(5));
});

test('generateWarren produces at least a few tunnels and veins connecting them', () => {
  const w = generateWarren(1);
  assert.ok(w.tunnels.length >= 4);
  assert.equal(w.veins.length, w.tunnels.length); // one vein per tunnel-to-next-tunnel link
  assert.ok(w.spores.length > 0);
});

test('generateTomb has one wall slot per energy band (7)', () => {
  const t = generateTomb(1);
  assert.equal(t.wallSlots.length, 7);
});

test('generateGeode has one spear per energy band (7), each tagged with its band index', () => {
  const g = generateGeode(1);
  assert.equal(g.spears.length, 7);
  const bands = g.spears.map((s) => s.band).sort((a, b) => a - b);
  assert.deepEqual(bands, [0, 1, 2, 3, 4, 5, 6]);
});

test('InteriorRealm construction is DOM-free', () => {
  assert.doesNotThrow(() => new InteriorRealm(1));
});

test('draw() is a no-op with no scene, and never throws for any of the four scenes', () => {
  const realm = new InteriorRealm(1);
  const ctx = fakeCtx();
  realm.draw(ctx, CANVAS, 1, { scene: null });
  assert.equal(ctx.calls.save, 0, 'no scene should draw nothing');

  for (const kind of ['warren', 'temple', 'tomb', 'geode']) {
    const r = new InteriorRealm(1);
    r.update(1000, 1 / 60, { sample: () => 0.5, globalEnergy: () => 0.5 });
    const c = fakeCtx();
    assert.doesNotThrow(() => r.draw(c, CANVAS, 0.8, { scene: { kind, seed: 42 }, haloColor: '#ffdca0', particleMul: 1, reducedFlash: false }));
    assert.ok(c.calls.save > 0, `${kind} should have drawn something`);
  }
});

test('draw() never throws at reduced-flash or low particleMul, or with a null energyCurves', () => {
  const r = new InteriorRealm(1);
  r.update(500, 1 / 60, null);
  r.onKick();
  const c = fakeCtx();
  assert.doesNotThrow(() => r.draw(c, CANVAS, 1, {
    scene: { kind: 'temple', seed: 9 }, haloColor: '#ff7a3c', particleMul: 0.3, reducedFlash: true,
  }));
});

test('geometry regenerates only when (kind, seed) changes, not on every draw', () => {
  const r = new InteriorRealm(1);
  const scene = { kind: 'geode', seed: 11 };
  r.draw(fakeCtx(), CANVAS, 1, { scene });
  const built1 = r._built;
  r.draw(fakeCtx(), CANVAS, 1, { scene }); // same scene again
  assert.equal(r._built, built1, 'identical (kind, seed) must not rebuild geometry');

  r.draw(fakeCtx(), CANVAS, 1, { scene: { kind: 'geode', seed: 12 } });
  assert.notEqual(r._built, built1, 'a new seed must rebuild geometry');
});

test('onKick raises the kick pulse, which decays over subsequent update() calls', () => {
  const r = new InteriorRealm(1);
  r.onKick();
  assert.equal(r.kickPulse, 1);
  let t = 0;
  for (let i = 0; i < 60; i++) { r.update(t, 1 / 120, null); t += 8.33; }
  assert.ok(r.kickPulse < 1 && r.kickPulse >= 0, `expected the pulse to have decayed, got ${r.kickPulse}`);
});
