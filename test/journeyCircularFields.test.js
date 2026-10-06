import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleJourneyState, journeyShorePair, journeyLakeShape, journeyLakeDistance,
  journeyGroundHeight, journeySurface,
} from '../src/world/alpine/JourneyWorld.js';
import { journeyMountainHeight } from '../src/world/alpine/JourneyMountains.js';
import { JOURNEY_ORBIT, journeyOrbitPoint } from '../src/world/alpine/JourneyOrbit.js';

const circumference = 2 * Math.PI * 1800;
const stateAt = (timeMs = 0, seed = 73) => sampleJourneyState({ timeMs, seed, circular: true });
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const derivative = (field, x) => (field(x + .05) - field(x - .05)) / .1;

// A missing circular state would silently select the legacy oval everywhere.
test('circular state keeps an unwrapped deterministic travel clock and freezes in reduced motion', () => {
  const state = stateAt(172800000);
  assert.equal(state.circular, true);
  assert.ok(state.travelM > 500 * circumference);
  assert.deepEqual(stateAt(172800000), state);
  assert.equal(sampleJourneyState().circular, false);
  const frozen = sampleJourneyState({ circular: true, reducedMotion: true, timeMs: 172800000,
    music: { energy01: 1, bass01: 1, bands: Array(7).fill(1) } });
  assert.deepEqual(frozen, stateAt(0, 0));
});

// Any noninteger longitude frequency causes either a visible height seam or
// a shading seam once the same longitude passes the camera on the next lap.
test('circular shore, ground and eroded ranges close with continuous longitude slopes', () => {
  for (const state of [stateAt(), stateAt(172800000, 1811), stateAt(17000, -58)]) {
    const fields = [
      x => journeyShorePair(x, state)[0], x => journeyShorePair(x, state)[1],
      x => journeyGroundHeight(x, journeyShorePair(x, state)[0] + 280, state),
      ...[1, 2].flatMap(layer => [.17, .31, .53, .79].map(v =>
        x => journeyMountainHeight(x, v, layer, state))),
    ];
    for (const field of fields) for (const x of [-circumference / 2, -81, 0, 653]) {
      close(field(x), field(x + circumference));
      close(derivative(field, x), derivative(field, x + circumference), 2e-7);
    }
  }
});

// Camera-local ovals, time-driven shores and music-driven terrain all change
// a fixed geographic place when time or the camera-local x coordinate changes.
test('one seeded circular geography survives scroll, seek and music changes', () => {
  const start = stateAt(0, 1021);
  const places = [-2370, 0, 411, 3760];
  for (const timeMs of [73000, 172800000, 19000, 0]) {
    const state = stateAt(timeMs, 1021);
    const loud = { ...state, timeSec: state.timeSec + 300, energy: 1, bass: 1, melody: 1,
      pulse: 1, bands: Array(7).fill(1) };
    assert.deepEqual(journeyLakeShape(state), journeyLakeShape(start));
    for (const place of places) {
      const x = place - state.travelM;
      for (const variant of [state, loud]) {
        const shore = journeyShorePair(x, variant), expected = journeyShorePair(place, start);
        shore.forEach((value, i) => close(value, expected[i]));
        close(journeyGroundHeight(x, shore[0] + 140, variant),
          journeyGroundHeight(place, expected[0] + 140, start));
        for (const layer of [1, 2]) for (const v of [.18, .45, .72]) {
          close(journeyMountainHeight(x, v, layer, variant), journeyMountainHeight(place, v, layer, start));
        }
      }
    }
  }
});

// A closed oval or a narrow pinch would strand the swimmer each circumference.
test('the circular lake is a broad connected belt with independent irregular shores', () => {
  for (const seed of [0, 73, 1811, 2917029651]) {
    const state = stateAt(0, seed), near = [], far = [], widths = [];
    for (let i = 0; i <= 240; i++) {
      const x = circumference * i / 240, shores = journeyShorePair(x, state);
      near.push(shores[0]); far.push(shores[1]); widths.push(shores[0] - shores[1]);
      assert.ok(widths.at(-1) > 400 && widths.at(-1) < 1200);
      assert.ok(journeyLakeDistance(x, (shores[0] + shores[1]) / 2, state) > 200);
      close(journeyLakeDistance(x, shores[0], state), 0);
      close(journeyLakeDistance(x, shores[1], state), 0);
      assert.ok(journeyLakeDistance(x, shores[0] + 10, state) < 0);
    }
    assert.ok(Math.max(...near) - Math.min(...near) > 100);
    assert.ok(Math.max(...far) - Math.min(...far) > 100);
    assert.ok(Math.max(...widths) - Math.min(...widths) > 130, 'banks have independent coves');
  }
});

// The contact shelf stays shallow while the continuous foreground wraps all
// the way to one shared pole, covering the backing sphere's front hemisphere.
test('spherical contact ground retains its shelf and closes smoothly at a shared near pole', () => {
  const state = stateAt(28000, 1811);
  const pole = JOURNEY_ORBIT.radiusM * Math.PI / 2 / JOURNEY_ORBIT.depthScale;
  for (const x of [-4300, -1200, 0, 731, 4300]) {
    const near = journeyShorePair(x, state)[0];
    assert.deepEqual(journeySurface(x, 0, 0, state), [x, 0, near]);
    close(journeySurface(x, .25, 0, state)[2], near + 650 * .25);
    const tip = journeySurface(x, 1, 0, state);
    close(tip[2], pole); close(tip[1], 35);
    journeyOrbitPoint(tip).forEach((value, i) => close(value, [0, -1800, 1835][i]));
    close(journeyGroundHeight(x, pole - .01, state), 35, 1e-7);
    assert.ok(journeyGroundHeight(x, near + 35, state) > 0);
  }
});

test('spherical ranges retain varied relief with restrained heights', () => {
  const state = stateAt(28000, 1811);
  for (const layer of [1, 2]) {
    const peaks = [], crests = [];
    for (let x = 0; x < circumference; x += 173) {
      const heights = Array.from({ length: 101 }, (_, i) => journeyMountainHeight(x, i / 100, layer, state));
      peaks.push(Math.max(...heights)); crests.push(heights.indexOf(peaks.at(-1)) / 100);
    }
    assert.ok(Math.max(...peaks) - Math.min(...peaks) > (layer === 1 ? 45 : 130));
    assert.ok(Math.max(...peaks) < (layer === 1 ? 330 : 850), 'relief fits the circular stage');
    assert.ok(Math.max(...crests) - Math.min(...crests) > .1, 'watersheds wander through depth');
  }
});
