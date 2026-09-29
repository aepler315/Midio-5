import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/world/ParticleField.js';
import { Murmuration } from '../src/world/Murmuration.js';
import { OrbitalDebris } from '../src/sim/OrbitalDebris.js';

function fakeCtx() {
  let arcs = 0, lines = 0, strokes = 0;
  return {
    get arcCount() { return arcs; },
    get lineCount() { return lines; },
    get strokeCount() { return strokes; },
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() { strokes++; }, closePath() {},
    arc() { arcs++; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    moveTo() {}, lineTo() { lines++; }, translate() {}, rotate() {}, roundRect() {}, fillRect() {}, strokeRect() {},
    ellipse() {}, quadraticCurveTo() {}, drawImage() {}, clearRect() {}, scale() {}, filter: '',
  };
}

test('ParticleField.draw draws fewer particles at a lower particleMul', () => {
  const full = new ParticleField({ kind: 'fireflies', color: '#fff', count: 20, speed: 10 }, 800, 600, 1);
  const ctxFull = fakeCtx(), ctxShed = fakeCtx();
  full.draw(ctxFull, 1);
  full.draw(ctxShed, 0.6);
  assert.equal(ctxFull.arcCount, 20);
  assert.equal(ctxShed.arcCount, 12);
});

test('Murmuration.draw draws fewer boids at a lower particleMul', () => {
  const m = new Murmuration(800, 600, 1);
  const ctxFull = fakeCtx(), ctxShed = fakeCtx();
  m.draw(ctxFull, 0, '#fff', 1);
  m.draw(ctxShed, 0, '#fff', 0.6);
  assert.equal(ctxFull.lineCount, 120); // 60 birds, two wings each
  assert.equal(ctxShed.lineCount, 72); // 36 birds
});

test('OrbitalDebris.draw draws fewer shards at a lower particleMul', () => {
  const d = new OrbitalDebris(1);
  const ctxFull = fakeCtx(), ctxShed = fakeCtx();
  d.draw(ctxFull, 200, 0, 1);
  d.draw(ctxShed, 200, 0, 0.6);
  assert.equal(ctxFull.strokeCount, 13);
  assert.equal(ctxShed.strokeCount, 8);
  assert.equal(ctxFull.lineCount, 39); // closed triangles
  assert.equal(ctxShed.lineCount, 24);
});

for (const mul of [0, -0.5, 2]) {
  test(`fixed-size particle consumers bound emitted geometry for multiplier ${mul}`, () => {
    const m = new Murmuration(800, 600, 1);
    const d = new OrbitalDebris(1);
    const birds = fakeCtx(), debris = fakeCtx();
    m.draw(birds, 0, '#fff', mul);
    d.draw(debris, 200, 0, mul);
    assert.equal(birds.lineCount, mul <= 0 ? 0 : 120);
    assert.equal(debris.strokeCount, mul <= 0 ? 0 : 13);
  });
}

test('empty particle collections emit no geometry', () => {
  const birds = fakeCtx(), debris = fakeCtx();
  new Murmuration(800, 600, 1, { n: 0 }).draw(birds, 0, '#fff', 1);
  new OrbitalDebris(1, { n: 0 }).draw(debris, 200, 0, 1);
  assert.equal(birds.lineCount, 0);
  assert.equal(debris.strokeCount, 0);
});
