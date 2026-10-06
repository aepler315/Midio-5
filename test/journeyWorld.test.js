import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_VIEW, JOURNEY_SURFACE_GLSL, sampleJourneyState,
  journeyNearShore, journeyFarShore, journeyGroundHeight, journeySurface, journeyLakeShape, journeyLakeDistance,
} from '../src/world/alpine/JourneyWorld.js';
import { MOUNTAIN_DIMENSIONS } from '../src/world/alpine/JourneyMountains.js';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { journeyGrid, journeyGridX } from '../src/world/alpine/JourneyMaterial.js';
import { JourneyScene } from '../src/world/alpine/JourneyScene.js';
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
  const a = at(0), b = at(180000), c = at(460000);
  const widths = [a,b,c].map(s => journeyLakeShape(s).halfWidthM);
  assert.ok(Math.max(...widths) - Math.min(...widths) > 25);
  const profile = s => {
    const lake = journeyLakeShape(s);
    return [-.7,-.3,0,.3,.7].map(q => {
      const x=lake.centerX+q*lake.halfWidthM;
      return journeyNearShore(x,s)-journeyFarShore(x,s);
    });
  };
  const profiles=[a,b,c].map(profile);
  const ratios = profiles.map(values => values[1] / values[3]);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > .05,
    'the two coves change the profile independently over long travel');
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
        assert.ok(point[2] >= near + 650 * v);
        if (v <= .3) assert.equal(point[2], near + 650 * v);
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

// Reintroducing audio-driven lake scaling would move roots and water boundaries
// instantly, even though heard time has not advanced.
test('basin geography is independent of live musical strength', () => {
  for (const timeMs of [0, 30000, 43200000]) {
    const quiet = at(timeMs, { music: null }), active = at(timeMs);
    assert.deepEqual(journeyLakeShape(active), journeyLakeShape(quiet));
    for (const x of [-450, -200, 0, 230, 450]) {
      assert.equal(journeyNearShore(x, active), journeyNearShore(x, quiet));
      assert.equal(journeyFarShore(x, active), journeyFarShore(x, quiet));
    }
  }
});

// Catch short-period dimension oscillations and advected fine noise that make
// the complete basin visibly breathe while the characters try to plant feet.
test('interior coves evolve at a geological pace rather than breathing every few seconds', () => {
  for (const seed of [0, 73, 1021, 2917029651]) {
    let maximumSpeed = 0;
    for (let timeMs = 0; timeMs < 180000; timeMs += 2500) {
      const state = at(timeMs, { seed }), next = at(timeMs + 100, { seed });
      const lake = journeyLakeShape(state);
      for (const q of [-.7, -.4, 0, .4, .7]) {
        const x = lake.centerX + q * lake.halfWidthM;
        for (const shore of [journeyNearShore, journeyFarShore]) {
          maximumSpeed = Math.max(maximumSpeed, Math.abs(shore(x, next) - shore(x, state)) / .1);
        }
      }
      assert.ok(Math.abs(journeyLakeShape(next).halfWidthM - lake.halfWidthM) < .08,
        'breadth changes by less than 0.8 m per second');
    }
    assert.ok(maximumSpeed < 5, `seed ${seed} shore speed ${maximumSpeed} m/s`);
  }
});

// An oval with one dent per side passes symmetry tests but still reads as a
// decorative cutout. Require two resolved recesses on each independent bank.
test('both banks contain multiple asymmetric coves separated by promontories', () => {
  const state = at(0), lake = journeyLakeShape(state);
  const coves = shore => {
    const heights = Array.from({ length: 171 }, (_, i) =>
      shore(lake.centerX + (-.85 + i * .01) * lake.halfWidthM, state)
        * (shore === journeyNearShore ? 1 : -1));
    const positions = [];
    for (let i = 15; i < heights.length - 15; i++) {
      if (heights[i] >= heights[i - 1] || heights[i] >= heights[i + 1]) continue;
      const prominence = Math.min(Math.max(...heights.slice(i - 15, i)),
        Math.max(...heights.slice(i + 1, i + 16))) - heights[i];
      if (prominence > 12) positions.push(-.85 + i * .01);
    }
    return positions;
  };
  const near = coves(journeyNearShore), far = coves(journeyFarShore);
  assert.ok(near.length >= 2, `near coves ${near}`);
  assert.ok(far.length >= 2, `far coves ${far}`);
  assert.ok(near.some(q => far.every(other => Math.abs(q - other) > .12)),
    'the two banks must not mirror the same cove outline');
});

// A flat extruded apron has constant depth slope; the integrated shelf has a
// smooth contact tangent, a low bank, and a separate inland rise.
test('the shared ground field has a smooth shallow shelf and inland relief', () => {
  for (const timeMs of [0, 30000, 43200000]) {
    const state = at(timeMs);
    for (const x of [-700, -250, 0, 310, 900]) {
      const shore = journeyNearShore(x, state);
      const height = d => journeyGroundHeight(x, shore + d, state);
      assert.ok(height(.1) / .1 < .005, 'bank contact tangent is smooth');
      assert.ok(height(35) < 7 && height(35) > 0, 'cast bank retains a shallow platform');
      assert.ok(height(650) - height(180) > 15, 'foreground rises behind the shelf');
      for (const d of [35, 90, 180, 350, 650]) {
        const slope = (height(d + .1) - height(d - .1)) / .2;
        const nextSlope = (height(d + .2) - height(d)) / .2;
        assert.ok(Math.abs(nextSlope - slope) < .002, 'continuous bank normals');
      }
    }
  }
});

// Use actual grid triangles and the staged camera. A depth-parameter endpoint
// alone cannot prove coverage: the complete finite apron can be in front of
// the camera, leaving visible clear color below its last row.
test('the shared foreground mesh covers the lower frame through aspect and phrase retreats', () => {
  const geometry = journeyGrid(THREE, 512, 24, 8400);
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), cross = new THREE.Vector3();
  const offset = new THREE.Vector3(), q = new THREE.Vector3(), direction = new THREE.Vector3();
  // Möller–Trumbore intersection against the shipped indexed triangles.
  // The compact vendored runtime deliberately excludes Ray/Raycaster.
  const intersectsGround = (camera, x, y) => {
    direction.set(x, y, .5).unproject(camera).sub(camera.position).normalize();
    for (let i = 0; i < geometry.index.count; i += 3) {
      a.fromBufferAttribute(position, geometry.index.getX(i));
      b.fromBufferAttribute(position, geometry.index.getX(i + 1));
      c.fromBufferAttribute(position, geometry.index.getX(i + 2));
      edge1.subVectors(b, a); edge2.subVectors(c, a); cross.crossVectors(direction, edge2);
      const determinant = edge1.dot(cross);
      if (Math.abs(determinant) < 1e-9) continue;
      offset.subVectors(camera.position, a);
      const u = offset.dot(cross) / determinant;
      if (u < 0 || u > 1) continue;
      q.crossVectors(offset, edge1);
      const v = direction.dot(q) / determinant;
      if (v < 0 || u + v > 1) continue;
      const depth = edge2.dot(q) / determinant;
      if (depth > camera.near && depth < camera.far) return true;
    }
    return false;
  };
  try {
    for (const timeMs of [28000, 48000, 43200000]) {
      const state = at(timeMs, { seed: 2917029651 }), lake = journeyLakeShape(state);
      for (let i = 0; i < position.count; i++) {
        const x = journeyGridX(uv.getX(i), lake, 8400);
        position.setXYZ(i, ...journeySurface(x, uv.getY(i), 0, state));
      }
      for (const [width, height] of [[1920, 1080], [1024, 1024], [720, 1280]]) {
        for (const cameraMove of [null, { dolly: -.09, yaw: .025, crane: .012, truck: 0, kind: 'pullback' }]) {
          const frame = { timeMs, seed: 2917029651, journeyDirection: { cameraMove },
            scenicViewport: { logicalWidth: width, logicalHeight: height, nominalWidth: width,
              nominalHeight: height, overscanPx: 0 } };
          const { pose, proj } = JourneyScene.prototype.movedPose(JOURNEY_VIEW, frame);
          const camera = new THREE.PerspectiveCamera(proj.fovYDeg, proj.aspect, 1, 16000);
          camera.position.fromArray(pose.eyeM); camera.lookAt(...pose.targetM); camera.updateMatrixWorld();
          for (const y of [-.7, -.95]) for (const x of [-.95, -.5, 0, .5, .95]) {
            assert.ok(intersectsGround(camera, x, y), `ground must cover lower frame at ${width}x${height}, ${timeMs}ms, ${x},${y}`);
          }
        }
      }
    }
  } finally {
    geometry.dispose();
  }
});

test('foreground extension retains dense shore samples and a continuous depth mapping', () => {
  const state = at(28000), x = 130, near = journeyNearShore(x, state);
  for (const v of [0, 1 / 24, 2 / 24, 3 / 24, 4 / 24, .25, .3]) {
    assert.equal(journeySurface(x, v, 0, state)[2], near + 650 * v,
      'contact shelf rows keep their original sampling');
  }
  let previous = near;
  for (let i = 1; i <= 200; i++) {
    const point = journeySurface(x, i / 200, 0, state);
    assert.ok(point[2] > previous && point.every(Number.isFinite));
    assert.equal(point[1], journeyGroundHeight(x, point[2], state));
    previous = point[2];
  }
  const slope = v => (journeySurface(x, v + 1e-5, 0, state)[2]
    - journeySurface(x, v - 1e-5, 0, state)[2]) / 2e-5;
  assert.ok(Math.abs(slope(.3 - 1e-4) - slope(.3 + 1e-4)) < .01,
    'the nonlinear tail joins with a continuous tangent');
});
