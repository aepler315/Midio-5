import test from 'node:test';
import assert from 'node:assert/strict';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { sampleWorldMusic } from '../src/world/WorldMusic.js';
import { FLINCH_SCALE, FLINCH_CONFIDENCE_FLOOR } from '../src/world/cathode/CathodeBoss.js';
import {
  boundaryLift01, rasterRate, rasterTravel, phosphorGlow, screenHit, tubeFlinch,
  motifTrust, scanPeriod, tearAmount, sectionAt,
} from '../src/world/cathode/Tube.js';

const chorus = { meanEnergy: 0.82, relEnergy01: 0.95, startMs: 60000, endMs: 90000, provenance: 'detected', label: 2 };
const verse = { meanEnergy: 0.48, relEnergy01: 0.5, startMs: 30000, endMs: 60000, provenance: 'detected', label: 1 };
const confident = FLINCH_CONFIDENCE_FLOOR + 0.1;

test('quiet songs crawl, mid energy cruises, dense material drops to half-time', () => {
  const quiet = rasterRate(0.05);
  const groove = rasterRate(0.40);
  const dense = rasterRate(0.95);
  assert.ok(quiet > 0, 'a verse still crawls, never freezes');
  assert.ok(groove > quiet, 'a groove should outrun a verse');
  assert.ok(dense < groove, 'dense songs must not strobe the floor');
  assert.ok(dense > quiet, 'half-time is still faster than a crawl');
});

test('reduced flash halves the raster without inventing a different shape', () => {
  assert.ok(Math.abs(rasterRate(0.40, true) * 2 - rasterRate(0.40)) < 1e-9);
  assert.ok(rasterRate(0.95, true) < rasterRate(0.40, true));
});

test('raster travel changes its local derivative when sustained energy changes', () => {
  const curves = new EnergyCurves(6000, 50);
  for (let i = 0; i < curves.n; i++) {
    const energy = i < 100 ? 0.05 : 0.40; // step at two seconds
    curves.setFrame(i, [energy, energy, energy, energy, energy, energy, energy]);
  }
  const dt = 0.02;
  const before = rasterTravel(1.8 + dt, curves) - rasterTravel(1.8, curves);
  const after = rasterTravel(3.8 + dt, curves) - rasterTravel(3.8, curves);
  assert.ok(Math.abs(after - before) > 0.01,
    `a sustained energy change must alter raster velocity (${before.toFixed(3)} -> ${after.toFixed(3)})`);
});

test('phosphor follows sustained bass, not a single kick', () => {
  const low = new EnergyCurves(4000, 50);
  const burst = new EnergyCurves(4000, 50);
  const high = new EnergyCurves(4000, 50);
  for (let i = 0; i < low.n; i++) {
    low.setFrame(i, [0.8, 0.8, 0.4, 0, 0, 0, 0]);
    burst.setFrame(i, [i === 100 ? 1 : 0, i === 100 ? 1 : 0, 0, 0, 0, 0, 0]);
    high.setFrame(i, [0, 0, 0, 0, 0.8, 0.8, 0.8]);
  }
  const held = phosphorGlow(sampleWorldMusic({ nowMs: 2000, energyCurves: low }).bass);
  const tap = phosphorGlow(sampleWorldMusic({ nowMs: 2000, energyCurves: burst }).bass);
  const treble = phosphorGlow(sampleWorldMusic({ nowMs: 2000, energyCurves: high }).bass);
  assert.ok(held > tap * 2, `bass glow ${held.toFixed(3)} vs kick ${tap.toFixed(3)}`);
  assert.ok(treble < 0.15, `treble is not phosphor, got ${treble.toFixed(3)}`);
});

test('sparse songs let an isolated accent flash the screen; dense songs filter it', () => {
  const hit = 0.45;
  const sparse = screenHit(hit, 0.05);
  const dense = screenHit(hit, 0.95);
  assert.ok(sparse > 0.3, `a lone hit on a quiet tube should show, got ${sparse.toFixed(3)}`);
  assert.equal(dense, 0, 'the same hit in a dense mix is not a strobe');
  assert.ok(screenHit(0.95, 0.95) > 0.5, 'a strong hit still marks a dense tube');
  assert.equal(screenHit(0, 0.05), 0);
});

test('a sparse locked beat still flinches; a dense locked beat without a hit does not', () => {
  const sparse = tubeFlinch({ phase01: 0, confidence: confident, accent: 0, energy: 0.1 });
  const denseIdle = tubeFlinch({ phase01: 0, confidence: confident, accent: 0, energy: 0.9 });
  const denseHit = tubeFlinch({ phase01: 0, confidence: confident, accent: 0.95, energy: 0.9 });
  assert.equal(sparse, FLINCH_SCALE);
  assert.equal(denseIdle, 1, 'dense material must not strobe every beat');
  assert.equal(denseHit, FLINCH_SCALE);
});

test('reduced flash is a statue, and unmetered songs never invent a pulse', () => {
  assert.equal(tubeFlinch({
    phase01: 0, confidence: confident, accent: 1, energy: 0.2, reducedFlash: true,
  }), 1);
  assert.equal(tubeFlinch({ phase01: 0, confidence: 0, accent: 0, energy: 0.2 }), 1);
  assert.equal(tubeFlinch({ phase01: 0.5, confidence: 0, accent: 0.9, energy: 0.05 }), FLINCH_SCALE);
});

test('returning labels pick a scan motif; decorative cuts keep the default raster', () => {
  assert.equal(scanPeriod(null), 3);
  assert.equal(scanPeriod({ provenance: 'decorative', label: 2 }), 3);
  assert.equal(motifTrust(chorus), 1);
  assert.equal(motifTrust({ ...chorus, provenance: 'inferred' }), 0.5);
  assert.equal(motifTrust({ ...chorus, provenance: 'decorative' }), 0);
  const a = scanPeriod(chorus);
  const again = scanPeriod({ ...chorus, startMs: 120000, endMs: 150000 });
  const other = scanPeriod(verse);
  assert.equal(a, again, 'the same label must return the same raster');
  assert.notEqual(a, other);
  assert.ok(a >= 2 && a <= 4);
});

test('an earned phrase lift is a real step; a decorative cut is not', () => {
  const lift = boundaryLift01(chorus, verse);
  assert.ok(lift > 0.9);
  assert.equal(boundaryLift01(verse, chorus), 0);
});

test('reduced flash kills the tear; a drop still registers as a number in range', () => {
  assert.equal(tearAmount(0.8, true), 0);
  assert.ok(tearAmount(0.8) > 0.7);
  assert.equal(tearAmount(-1), 0);
  assert.equal(tearAmount(4), 1);
});

test('sectionAt is a function of the clock, so a backward seek cannot keep a later motif', () => {
  const sections = [verse, chorus];
  assert.equal(sectionAt(sections, 45000).section, verse);
  assert.equal(sectionAt(sections, 70000).section, chorus);
  assert.equal(sectionAt(sections, 70000).prev, verse);
  assert.equal(sectionAt(sections, 0).section, verse);
  assert.equal(sectionAt([], 1000).section, null);
  sectionAt(sections, 90000);
  assert.equal(sectionAt(sections, 45000).section, verse);
});
