import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOUNTAIN_DIMENSIONS, JOURNEY_MOUNTAIN_GLSL, journeyMountainHeight,
} from '../src/world/alpine/JourneyMountains.js';

const stateAt = (timeSec = 0, seed = 73, music = {}) => ({
  timeSec, travelM: 38 * timeSec + 24 * Math.sin(timeSec * .025), seed,
  energy: 0, bass: 0, melody: 0, pulse: 0, bands: Array(7).fill(0), ...music,
});
const loud = { energy: .8, bass: .7, melody: .9, pulse: .6,
  bands: [.1, .7, .3, .9, .5, .8, .2] };
const height = (x, v, layer, state = stateAt()) => journeyMountainHeight(x, v, layer, state);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = values => Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2)));

function crest(x, layer, state) {
  let y = 0, depth = 0;
  for (let i = 0; i <= 100; i++) {
    const sample = height(x, i / 100, layer, state);
    if (sample > y) { y = sample; depth = i / 100; }
  }
  return { y, depth };
}

test('mountain feet meet the basin and both massifs decay smoothly at their far edge', () => {
  assert.ok(Object.isFrozen(MOUNTAIN_DIMENSIONS));
  assert.deepEqual(MOUNTAIN_DIMENSIONS, {
    firstDepth: 2300, rearStart: -3000, rearDepth: 4700, rearFootHeight: 70,
  });
  for (const state of [stateAt(), stateAt(43200, 291, loud)]) {
    for (const x of [-4300, -790, 0, 970, 4600]) {
      assert.equal(height(x, 0, 1, state), 0);
      assert.equal(height(x, 0, 2, state), MOUNTAIN_DIMENSIONS.rearFootHeight);
      for (const layer of [1, 2]) {
        const peak = crest(x, layer, state);
        const foot = layer === 1 ? 0 : MOUNTAIN_DIMENSIONS.rearFootHeight;
        assert.ok(peak.depth > .25 && peak.depth < .78, `interior crest at ${peak.depth}`);
        assert.ok(height(x, 1, layer, state) < peak.y * .16, 'distant edge descends out of view');
        assert.ok(height(x, .0001, layer, state) - foot < .001, 'front has a horizontal contact tangent');
        assert.ok(Math.abs(height(x, 1, layer, state) - height(x, .9999, layer, state)) < .001);
        assert.equal(height(x, -1, layer, state), height(x, 0, layer, state));
        assert.equal(height(x, 2, layer, state), height(x, 1, layer, state));
      }
    }
  }
});

test('the two ranges contain unequal summits and substantial alpine passes at their new scale', () => {
  for (const state of [stateAt(30, 1811), stateAt(175, 73), stateAt(43200, 1021)]) {
    for (const layer of [1, 2]) {
      const peaks = [];
      for (let x = -6000; x <= 6000; x += 60) peaks.push(crest(x, layer, state).y);
      const low = Math.min(...peaks), high = Math.max(...peaks);
      assert.ok(low > (layer === 1 ? 150 : 550), `layer ${layer} lowest pass ${low}`);
      assert.ok(high < (layer === 1 ? 720 : 2150), `layer ${layer} highest summit ${high}`);
      assert.ok(high > (layer === 1 ? 500 : 1600), `layer ${layer} reaches massif scale: ${high}`);
      assert.ok(high - low > (layer === 1 ? 200 : 650), `layer ${layer} has deep passes: ${high - low}`);
    }
  }
});

test('crests have fine erosion and irregularly spaced peaks instead of a repeated zigzag', () => {
  const state = stateAt(30, 1811);
  for (const layer of [1, 2]) {
    const peaks = [];
    for (let x = -6000; x <= 6000; x += 20) peaks.push(crest(x, layer, state).y);
    const residual = [], summits = [];
    for (let i = 5; i < peaks.length - 5; i++) {
      residual.push(peaks[i] - mean(peaks.slice(i - 5, i + 6)));
      if (peaks[i] > Math.max(...peaks.slice(i - 4, i)) && peaks[i] > Math.max(...peaks.slice(i + 1, i + 5))) summits.push(i);
    }
    const spacing = summits.slice(1).map((index, i) => index - summits[i]);
    assert.ok(deviation(residual) > (layer === 1 ? 2.5 : 5), `layer ${layer} fine crest relief ${deviation(residual)}`);
    assert.ok(summits.length >= 8, `layer ${layer} has ${summits.length} local crests`);
    assert.ok(deviation(spacing) / mean(spacing) > .25, 'peak spacing is naturally irregular');
  }
});

test('branching faces change depth profiles and slope directions across each mountain', () => {
  for (const layer of [1, 2]) {
    const ratios = [], crestDepths = [], slopes = [];
    const depthM = layer === 1 ? MOUNTAIN_DIMENSIONS.firstDepth : MOUNTAIN_DIMENSIONS.rearDepth;
    for (let x = -4500; x <= 4500; x += 150) {
      ratios.push(height(x, .3, layer) / height(x, .67, layer));
      crestDepths.push(crest(x, layer).depth);
      for (const v of [.24, .37, .55, .71]) {
        slopes.push({ dx: (height(x + 5, v, layer) - height(x - 5, v, layer)) / 10,
          dz: (height(x, v + 5 / depthM, layer) - height(x, v - 5 / depthM, layer)) / 10 });
      }
    }
    assert.ok(Math.max(...ratios) - Math.min(...ratios) > .4, 'faces cannot share an extruded depth profile');
    assert.ok(Math.max(...crestDepths) - Math.min(...crestDepths) > .13, 'the watershed wanders in depth');
    assert.ok(slopes.filter(s => s.dx > .08 && s.dz > .08).length > 12);
    assert.ok(slopes.filter(s => s.dx < -.08 && s.dz > .08).length > 12);
    assert.ok(slopes.filter(s => s.dx > .08 && s.dz < -.08).length > 12);
    assert.ok(slopes.filter(s => s.dx < -.08 && s.dz < -.08).length > 12);
  }
});

test('upper arêtes have narrow crowns while the massifs retain broad shoulders', () => {
  const state = stateAt(28, 1811);
  for (const layer of [1, 2]) {
    const crownWidths = [], shoulderWidths = [];
    for (let x = -4500; x <= 4500; x += 150) {
      const profile = Array.from({ length: 501 }, (_, i) => height(x, i / 500, layer, state));
      const peak = Math.max(...profile);
      crownWidths.push(profile.filter(y => y > peak * .97).length / 500);
      shoulderWidths.push(profile.filter(y => y > peak * .5).length / 500);
    }
    crownWidths.sort((a, b) => a - b);
    const typicalCrown = crownWidths[Math.floor(crownWidths.length / 2)];
    assert.ok(typicalCrown < .057, `layer ${layer} crown depth ${typicalCrown} reads as a rounded dome`);
    assert.ok(mean(shoulderWidths) > .23, 'sharper crests retain the body beneath them');
  }
});

test('upper face erosion breaks the continuous corrugations in the depth direction', () => {
  const state = stateAt(28, 1811);
  for (const layer of [1, 2]) {
    const depthM = layer === 1 ? MOUNTAIN_DIMENSIONS.firstDepth : MOUNTAIN_DIMENSIONS.rearDepth;
    const across = [], through = [];
    for (let x = -4500; x <= 4500; x += 150) for (const v of [.31, .39, .47, .55, .63]) {
      const center = height(x, v, layer, state);
      across.push(height(x + 80, v, layer, state) - 2 * center + height(x - 80, v, layer, state));
      through.push(height(x, v + 80 / depthM, layer, state) - 2 * center + height(x, v - 80 / depthM, layer, state));
    }
    const rms = values => Math.sqrt(mean(values.map(value => value * value)));
    // Permit elongated gullies, but require visible depth relief and limit
    // the directional curvature imbalance to 3:1 at a physical 80 m scale.
    assert.ok(rms(through) > 15, `layer ${layer} upper faces need relief through depth`);
    assert.ok(rms(across) / rms(through) < 3, `layer ${layer} erosion cannot form parallel folds all the way downslope`);
  }
});

test('terrain is continuous, stateless and advected identically after long and reverse seeks', () => {
  const times = [0, 123.45, 43200, 172800, 17];
  for (const time of times) {
    const state = stateAt(time, 73, loud), later = stateAt(time + 1 / 60, 73, loud);
    const copy = structuredClone(state);
    for (const layer of [1, 2]) for (const x of [-3100, -483, 0, 639, 4270]) {
      for (const v of [.13, .3, .49, .67, .91]) {
        const y = height(x, v, layer, state);
        assert.ok(Number.isFinite(y));
        assert.equal(height(x, v, layer, copy), y);
        assert.equal(height(x, v, layer, { ...state, timeSec: time + 1e6 }), y, 'time alone cannot deform geology');
        assert.ok(Math.abs(height(x + 319, v, layer, state) - height(x, v, layer, { ...state, travelM: state.travelM + 319 })) < 1e-8);
        assert.ok(Math.abs(height(x + .01, v, layer, state) - y) < .12, 'no discontinuous x seams');
        assert.ok(Math.abs(height(x, v + 1e-6, layer, state) - y) < .1, 'no discontinuous depth seams');
        assert.ok(Math.abs(height(x, v, layer, later) - y) < 7, 'continuous advection at playback cadence');
      }
    }
  }
  assert.equal(journeyMountainHeight(17, .4, 2), journeyMountainHeight(17, .4, 2));
});

test('music expands local shoulders modestly and all seven bands retain spatial authority', () => {
  for (const time of [0, 172800]) {
    const quiet = stateAt(time), active = stateAt(time, 73, loud);
    const changed = { ...active, energy: active.energy + .0001, bass: active.bass + .0001,
      melody: active.melody + .0001, pulse: active.pulse + .0001, bands: active.bands.map(value => value + .0001) };
    const responses = [];
    for (const layer of [1, 2]) for (let x = -6000; x <= 6000; x += 173) {
      for (const v of [.27, .42, .61, .78]) {
        const base = height(x, v, layer, quiet), y = height(x, v, layer, active);
        responses.push((y - base) / base);
        assert.ok(y >= base && y - base < 95, `bounded shoulder growth ${y - base}`);
        assert.ok(Math.abs(height(x, v, layer, changed) - y) < .03, 'music never multiplies elapsed phase');
      }
    }
    assert.ok(Math.max(...responses) - Math.min(...responses) > .025, 'response cannot be a uniform scale');
  }
  const quiet = stateAt(123);
  for (let band = 0; band < 7; band++) {
    const bands = Array(7).fill(0); bands[band] = 1;
    const active = { ...quiet, bands };
    let maximum = 0;
    for (let x = -7000; x <= 7000; x += 97) {
      for (const v of [.28, .46, .63]) maximum = Math.max(maximum, height(x, v, 2, active) - height(x, v, 2, quiet));
    }
    assert.ok(maximum > 1, `band ${band} can expand a shoulder: ${maximum}`);
  }
});

// Execute the public scalar GLSL text itself to catch drift between its
// formula and the CPU implementation; renderer smoke checks real compilation.
function shaderHeight(state) {
  const source = JOURNEY_MOUNTAIN_GLSL
    .replace(/\bfloat\s+(journeyMountain\w*)\s*\(([^)]*)\)/g, (_, name, parameters) =>
      `function ${name}(${parameters.replace(/\b(?:float|vec2)\s+/g, '')})`)
    .replace(/\b(?:float|int)\s+(\w+)/g, 'let $1')
    .replace(/\bfloat\(([^()]*)\)/g, 'Number($1)');
  return new Function('state', `
    const { travelM:uJourneyTravel, seed:uJourneySeed, energy:uJourneyEnergy,
      bass:uJourneyBass, melody:uJourneyMelody, pulse:uJourneyPulse, bands:uJourneyBands } = state;
    const { sin, sqrt, min, max, abs } = Math;
    const clamp = (v,a,b) => min(b,max(a,v));
    const step = (edge,v) => v < edge ? 0 : 1;
    const mix = (a,b,t) => a+(b-a)*t;
    const smoothstep = (a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
    ${source}
    return journeyMountainHeight;
  `)(state);
}

test('the exported CPU and GLSL relief agree across layers, music and long travel', () => {
  for (const state of [stateAt(), stateAt(153, 1811, loud), stateAt(43200, 17, loud), stateAt(172800)]) {
    const shader = shaderHeight(state);
    for (const x of [-6200, -511, 0, 173, 5700]) for (const layer of [1, 2]) {
      for (const v of [0, .11, .27, .51, .63, .85, 1]) {
        assert.ok(Math.abs(shader({ x, y: v }, layer) - height(x, v, layer, state)) < 1e-8,
          `CPU/GLSL disagreement at ${x}, ${v}, ${layer}, ${state.timeSec}`);
      }
    }
  }
});
