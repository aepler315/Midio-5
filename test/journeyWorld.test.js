import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_VIEW, JOURNEY_SURFACE_GLSL, sampleJourneyState,
  journeyNearShore, journeyFarShore, journeyGroundHeight, journeySurface, journeyLakeShape, journeyLakeDistance,
} from '../src/world/alpine/JourneyWorld.js';
import { MOUNTAIN_DIMENSIONS } from '../src/world/alpine/JourneyMountains.js';
import { cameraPoseAt, cameraRailErrors, projectPoint } from '../src/world/terrain/SceneTravel.js';

const music = { energy01: .7, bass01: .4, melody01: .8, pulse01: .3,
  bands: [.1, .7, .2, .9, .3, .8, .4] };
const at = (timeMs, extra = {}) => sampleJourneyState({ timeMs, seed: 73, music, ...extra });
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('journey view is an immutable imagined place with a valid camera rail', () => {
  assert.equal(JOURNEY_VIEW.id, 'moonlit-journey');
  assert.match(`${JOURNEY_VIEW.name} ${JOURNEY_VIEW.title} ${JOURNEY_VIEW.place}`, /imagined/i);
  assert.deepEqual(JOURNEY_VIEW.composition, { foreground: 'none', nearLedgeMaxFrac: 0 });
  assert.deepEqual(cameraRailErrors(JOURNEY_VIEW.camera), []);
  assert.deepEqual(cameraPoseAt(JOURNEY_VIEW, .5), {
    eyeM: [0, 245, 820], targetM: [0, 230, -1200], fovYDeg: 44,
  });
  for (const value of [JOURNEY_VIEW, JOURNEY_VIEW.camera, JOURNEY_VIEW.camera.eyeStartM,
    JOURNEY_VIEW.camera.targetEndM, JOURNEY_VIEW.composition]) assert.ok(Object.isFrozen(value));
});

test('state sanitizes missing and nonfinite music without keeping input array references', () => {
  const empty = sampleJourneyState({ timeMs: NaN, seed: Infinity });
  assert.deepEqual(empty, { timeSec: 0, travelM: 0, seed: 0,
    energy: 0, bass: 0, melody: 0, pulse: 0, bands: [0, 0, 0, 0, 0, 0, 0] });
  assert.deepEqual(sampleJourneyState(), empty);
  const bands = [NaN, Infinity, -2, 2, .2];
  const state = sampleJourneyState({ timeMs: -30, music: {
    energy01: 3, bass01: -1, melody01: Infinity, pulse01: .25, bands,
  } });
  assert.equal(state.timeSec, 0);
  assert.deepEqual([state.energy, state.bass, state.melody, state.pulse], [1, 0, 0, .25]);
  assert.deepEqual(state.bands, [0, 0, 0, 1, .2, 0, 0]);
  bands[4] = 1;
  assert.equal(state.bands[4], .2);
});

test('heard time has a steady forward rate even at large seek positions', () => {
  for (const timeMs of [0, 60000, 3599999, 43200000, 172800000]) {
    const a = at(timeMs), b = at(timeMs + 1000 / 60);
    const rate = (b.travelM - a.travelM) * 60;
    assert.ok(rate > 37 && rate < 39, `travel rate ${rate} at ${timeMs}`);
    assert.equal(a.travelM, at(timeMs, { music: null }).travelM);
    for (const layer of [0, 1, 2]) {
      assert.ok(distance(journeySurface(317, .47, layer, a), journeySurface(317, .47, layer, b)) < 3);
    }
  }
});

test('held time and reverse seeks restore the same entire world', () => {
  const samples = [0, 17000, 630000, 7500, 43200000].map(timeMs => ({ timeMs,
    state: at(timeMs), surfaces: [0, 1, 2].map(layer => journeySurface(-371, .53, layer, at(timeMs))) }));
  for (const item of samples.reverse()) {
    assert.deepEqual(at(item.timeMs), item.state);
    assert.deepEqual([0, 1, 2].map(layer => journeySurface(-371, .53, layer, at(item.timeMs))), item.surfaces);
  }
});

test('reduced motion freezes time, advection and every spatial musical strength', () => {
  const frozen = at(0, { reducedMotion: true, music: null });
  assert.deepEqual([frozen.timeSec, frozen.travelM, frozen.energy, frozen.bass, frozen.melody, frozen.pulse], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(frozen.bands, [0, 0, 0, 0, 0, 0, 0]);
  for (const timeMs of [10000, 43200000, 500]) {
    const state = at(timeMs, { reducedMotion: true });
    assert.deepEqual(state, frozen);
    for (const layer of [0, 1, 2]) assert.deepEqual(journeySurface(126, .4, layer, state), journeySurface(126, .4, layer, frozen));
  }
});

test('the lake closes at two visible ends with dry banks beyond them across seeds and long travel', () => {
  const pose = cameraPoseAt(JOURNEY_VIEW, .5);
  for (const seed of [0, 73, 1021, -58, 2917029651]) {
    for (const timeMs of [0, 23000, 630000, 43200000]) {
      const state = at(timeMs, { seed }), lake = journeyLakeShape(state);
      assert.ok(lake.halfWidthM >= 460 && lake.halfWidthM <= 655);
      for (const side of [-1, 1]) {
        const x = lake.centerX + side * lake.halfWidthM;
        const near = journeyNearShore(x, state), far = journeyFarShore(x, state);
        assert.ok(Math.abs(near - far) < 1e-9, 'margins meet at a finite tip');
        const tip = projectPoint(pose, 16 / 9, [x, 0, near]);
        assert.ok(Math.abs(tip.x) < 1 && tip.y > -1, 'lateral ends remain in the composition');
        assert.ok(journeyLakeDistance(x + side * 25, near, state) < 0);
      }
      for (let q = -.95; q <= .95; q += .05) {
        const x = lake.centerX + q * lake.halfWidthM;
        const near = journeyNearShore(x, state), far = journeyFarShore(x, state);
        assert.ok(near > far && near - far < 1250);
        assert.ok(journeyLakeDistance(x, (near + far) / 2, state) > 0);
        assert.equal(journeyLakeDistance(x, near, state), 0);
        assert.equal(journeyLakeDistance(x, far, state), 0);
      }
    }
  }
});

test('the basin changes breadth, depth and cove shape smoothly instead of translating a strip', () => {
  const a = at(0), b = at(18000), c = at(46000);
  const widths = [a,b,c].map(s => journeyLakeShape(s).halfWidthM);
  assert.ok(Math.max(...widths) - Math.min(...widths) > 80);
  const profile = s => {
    const lake = journeyLakeShape(s);
    return [-.7,-.3,0,.3,.7].map(q => {
      const x=lake.centerX+q*lake.halfWidthM;
      return journeyNearShore(x,s)-journeyFarShore(x,s);
    });
  };
  const profiles=[a,b,c].map(profile);
  assert.ok(Math.abs(profiles[0][1]/profiles[0][3]-profiles[1][1]/profiles[1][3])>.05,
    'the two coves change the profile independently');
  for (const timeMs of [0,9000,27000,43200000]) {
    const state=at(timeMs), next=at(timeMs+1000/60), lake=journeyLakeShape(state);
    for (const q of [-1.001,-1,-.999,-.7,0,.7,.999,1,1.001]) {
      const x=lake.centerX+q*lake.halfWidthM;
      for (const shore of [journeyNearShore,journeyFarShore]) {
        assert.ok(Math.abs(shore(x,next)-shore(x,state))<2, 'no jump when a tip moves past a point');
        assert.ok(Math.abs(shore(x+.001,state)-shore(x,state))<.02, 'finite tip slope');
      }
    }
  }
});

test('water boundary, bank surface and actor ground use the same shoreline', () => {
  for (const timeMs of [0, 125000, 43200000]) {
    const state = at(timeMs);
    for (let x = -2500; x <= 2500; x += 173) {
      const near = journeyNearShore(x, state);
      assert.equal(journeyGroundHeight(x, near, state), 0);
      assert.equal(journeyGroundHeight(x, near - 25, state), 0);
      const actorHeight = journeyGroundHeight(x, near + 35, state);
      assert.ok(actorHeight > 0 && actorHeight < 7, `bank at actor ${actorHeight}`);
      assert.deepEqual(journeySurface(x, 0, 0, state), [x, 0, near]);
      for (const v of [.05, .25, .65, 1]) {
        const point = journeySurface(x, v, 0, state);
        assert.equal(point[2], near + 650 * v);
        assert.equal(point[1], journeyGroundHeight(x, point[2], state));
        assert.ok(point[1] > 0 && point[1] <= 45);
      }
    }
  }
});

test('ranges are deep heightfields with the rear massif behind and above the first crest', () => {
  for (const timeMs of [0, 175000, 43200000]) {
    const state = at(timeMs);
    for (const x of [-1900, -700, 0, 850, 2150]) {
      const first = Array.from({ length: 101 }, (_, i) => journeySurface(x, i / 100, 1, state));
      const rear = Array.from({ length: 101 }, (_, i) => journeySurface(x, i / 100, 2, state));
      assert.deepEqual(first[0], [x, 0, journeyFarShore(x, state)]);
      assert.ok(Math.abs(first[0][2] - first.at(-1)[2] - MOUNTAIN_DIMENSIONS.firstDepth) < 1e-9);
      assert.ok(Math.abs(rear[0][2] - rear.at(-1)[2] - MOUNTAIN_DIMENSIONS.rearDepth) < 1e-9);
      const firstPeak = first.reduce((a, b) => a[1] > b[1] ? a : b);
      const rearPeak = rear.reduce((a, b) => a[1] > b[1] ? a : b);
      assert.ok(firstPeak[1] >= 180 && firstPeak[1] <= 850, `first peak ${firstPeak}`);
      assert.ok(rearPeak[1] >= 700 && rearPeak[1] <= 2400, `rear peak ${rearPeak}`);
      assert.ok(rearPeak[1] > firstPeak[1] + 30);
      assert.ok(rearPeak[2] < first.at(-1)[2] - 150);
      assert.ok(first.at(-1)[1] < firstPeak[1] * .3);
      assert.ok(rear.at(-1)[1] < rearPeak[1] * .35);
      for (let i = 1; i < first.length; i++) {
        assert.ok(first[i][2] < first[i - 1][2]);
        assert.ok(rear[i][2] < rear[i - 1][2]);
      }
    }
  }
  const state = at(41000);
  for (const layer of [1, 2]) {
    const ratio = x => journeySurface(x, .28, layer, state)[1] / journeySurface(x, .67, layer, state)[1];
    assert.ok(Math.abs(ratio(-730) - ratio(610)) > .03, 'depth profiles must vary across the range');
  }
});

test('preview has distinct alpine summits and saddles above a generously framed lake', () => {
  const state = at(30000, { seed: 2917029651 }), pose = cameraPoseAt(JOURNEY_VIEW, .5);
  const near = projectPoint(pose, 16 / 9, [0, 0, journeyNearShore(0, state)]);
  const far = projectPoint(pose, 16 / 9, [0, 0, journeyFarShore(0, state)]);
  assert.ok(near.y < -.7 && near.y > -.98, `foreground shore y ${near.y}`);
  assert.ok((far.y - near.y) / 2 > .18, 'lake has a generous vertical span');
  for (const layer of [1, 2]) {
    const peaks = [];
    for (let x = -2000; x <= 2000; x += 40) {
      let high = 0;
      for (let i = 0; i <= 80; i++) high = Math.max(high, journeySurface(x, i / 80, layer, state)[1]);
      peaks.push(high);
    }
    const high = Math.max(...peaks), low = Math.min(...peaks);
    assert.ok(high - low > (layer === 1 ? 130 : 260), `layer ${layer} relief ${high - low}`);
    if (layer === 2) {
      assert.ok(high > 1500 && low < 1300, `rear crest height span ${low}–${high}`);
      assert.ok(peaks.filter(y => y > 1000).length > 10, 'several summits reach the snow zone');
    }
  }
});

test('tiny music changes cannot produce a large-time phase jump', () => {
  for (const timeMs of [0, 43200000, 172800000]) {
    const a = at(timeMs), b = at(timeMs, { music: { ...music,
      energy01: music.energy01 + .0001, bass01: music.bass01 + .0001,
      melody01: music.melody01 + .0001, pulse01: music.pulse01 + .0001,
      bands: music.bands.map(value => value + .0001),
    } });
    assert.equal(a.travelM, b.travelM);
    assert.ok(Math.abs(journeyNearShore(43, a) - journeyNearShore(43, b)) < .03);
    assert.ok(Math.abs(journeyFarShore(43, a) - journeyFarShore(43, b)) < .03);
    for (const layer of [0, 1, 2]) {
      const p = journeySurface(43, .53, layer, a), q = journeySurface(43, .53, layer, b);
      assert.ok(distance(p, q) < .03);
    }
  }
});

test('all bands shape the rear massif through continuous overlapping shoulders', () => {
  const quiet = at(123000, { music: null });
  for (let band = 0; band < 7; band++) {
    const bands = Array(7).fill(0);
    bands[band] = 1;
    const loud = at(123000, { music: { bands } });
    let maxResponse = 0;
    for (let x = -5000; x <= 5000; x += 71) {
      for (const v of [.3, .55, .7]) {
        const a = journeySurface(x, v, 2, loud), b = journeySurface(x, v, 2, quiet);
        maxResponse = Math.max(maxResponse, a[1] - b[1]);
        assert.equal(a[2], b[2]);
        assert.ok(Math.abs(journeySurface(x + .01, v, 2, loud)[1] - a[1]) < .1);
      }
    }
    assert.ok(maxResponse > 2, `band ${band} must influence the landscape`);
  }
});

// Evaluate the exported scalar GLSL subset, rather than duplicating the
// terrain formulas in a test oracle. Real shader compilation is covered by
// the renderer smoke; this catches CPU/shader edits drifting independently.
function shaderEvaluator(state) {
  const source = JOURNEY_SURFACE_GLSL
    .replace(/uniform\s+float\s+[^;]+;/g, '')
    .replace(/\b(?:float|vec2|vec3)\s+(journey\w+)\s*\(([^)]*)\)/g, (_, name, parameters) =>
      `function ${name}(${parameters.replace(/\b(?:float|vec2)\s+/g, '')})`)
    .replace(/\b(?:float|int|vec2|vec3)\s+(\w+)/g, 'let $1')
    .replace(/\bfloat\(([^()]*)\)/g, 'Number($1)');
  const make = new Function('uniforms', `
    const { uJourneyTime, uJourneyTravel, uJourneySeed, uJourneyEnergy,
      uJourneyBass, uJourneyMelody, uJourneyPulse, uJourneyBands } = uniforms;
    const { sin, cos, abs, sqrt, min, max, pow } = Math;
    const clamp = (v,a,b) => min(b,max(a,v));
    const smoothstep = (a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
    const mix = (a,b,t) => a+(b-a)*t;
    const step = (edge,x) => x<edge?0:1;
    const vec2 = (x,y) => ({x,y});
    const vec3 = (x,y,z) => Object.assign([x,y,z],{x,y,z});
    ${source}
    return { journeyNearShore, journeyFarShore, journeyGroundHeight, journeySurface };
  `);
  return make({ uJourneyTime: state.timeSec, uJourneyTravel: state.travelM,
    uJourneySeed: state.seed, uJourneyEnergy: state.energy, uJourneyBass: state.bass,
    uJourneyMelody: state.melody, uJourneyPulse: state.pulse, uJourneyBands: state.bands });
}

test('exported shader formulas agree with CPU shores, ground and every surface', () => {
  for (const state of [sampleJourneyState(), at(153000), at(43200000), at(121000, { reducedMotion: true })]) {
    const shader = shaderEvaluator(state);
    for (const x of [-2500, -511, 0, 173, 3700]) {
      assert.ok(Math.abs(shader.journeyNearShore(x) - journeyNearShore(x, state)) < 1e-8);
      assert.ok(Math.abs(shader.journeyFarShore(x) - journeyFarShore(x, state)) < 1e-8);
      const z = journeyNearShore(x, state) + 35;
      assert.ok(Math.abs(shader.journeyGroundHeight({ x, y: z }) - journeyGroundHeight(x, z, state)) < 1e-8);
      for (const layer of [0, 1, 2]) for (const v of [0, .27, .63, 1]) {
        assert.ok(distance(shader.journeySurface({ x, y: v }, layer), journeySurface(x, v, layer, state)) < 1e-8);
      }
    }
  }
});
