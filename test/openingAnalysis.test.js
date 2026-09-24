// Starting a long song on its opening and finishing its analysis while it
// plays (src/audio/OpeningAnalysis.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_SECONDS_FOR_OPENING, OPENING_SECONDS, adoptFullAnalysis, asOpening, extendBarGrid, sliceAudioBuffer, useOpeningAnalysis,
} from '../src/audio/OpeningAnalysis.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';

test('only a single long file starts on its opening', () => {
  assert.equal(OPENING_SECONDS, 15);
  assert.equal(useOpeningAnalysis({ durationSec: 300 }), true);
  assert.equal(useOpeningAnalysis({ durationSec: MIN_SECONDS_FOR_OPENING - 1 }), false, 'a short song is quick whole');
  assert.equal(useOpeningAnalysis({ durationSec: 300, stemDrop: true }), false, 'stems cast from their full length');
  assert.equal(useOpeningAnalysis({ durationSec: 300, exporting: true }), false, 'an export renders from final data');
});

function fakeBuffer(seconds, rate = 100, channels = 2) {
  const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: seconds * rate }, (_, i) => c * 1000 + i));
  return { length: seconds * rate, sampleRate: rate, numberOfChannels: channels, getChannelData: (c) => data[c] };
}
const make = ({ length, numberOfChannels, sampleRate }) => {
  const chans = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return { length, numberOfChannels, sampleRate, getChannelData: (c) => chans[c], copyToChannel: (src, c) => chans[c].set(src) };
};

test('the opening slice is the first seconds of every channel', () => {
  const slice = sliceAudioBuffer(fakeBuffer(60), 15, make);
  assert.equal(slice.length, 1500);
  assert.equal(slice.numberOfChannels, 2);
  assert.equal(slice.getChannelData(1)[0], 1000);
  assert.equal(slice.getChannelData(0)[1499], 1499);
  assert.equal(sliceAudioBuffer(fakeBuffer(10), 15, make).length, 1000, 'never longer than the song');
});

test('the bar grid carries on past the opening at its own bar length', () => {
  const grid = Array.from({ length: 8 }, (_, i) => ({ ms: 400 + i * 2000, tick: i * 4, numerator: 4, denominator: 4, index: i }));
  const out = extendBarGrid(grid, 30000);
  assert.deepEqual(out.slice(0, 8), grid, 'the analysed bars are untouched');
  assert.ok(out.length > grid.length);
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(out[i].ms - out[i - 1].ms - 2000) < 1e-9);
    assert.equal(out[i].tick - out[i - 1].tick, 4);
    assert.equal(out[i].index, i);
  }
  assert.ok(out[out.length - 1].ms < 30000 && out[out.length - 1].ms + 2000 >= 30000);
  assert.deepEqual(extendBarGrid([], 30000), [], 'free time stays free');
});

test('an opening stands for the whole song until the whole analysis lands', () => {
  const curves = new EnergyCurves(15000, 50);
  curves.setFrame(curves.n - 1, [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
  const result = {
    timeline: [{ tMs: 100 }], durationMs: 15000, energyCurves: curves, songProfile: { version: 1, watch: { drive: 0.4 } },
    barGrid: [{ ms: 0, tick: 0, numerator: 4 }, { ms: 2000, tick: 4, numerator: 4 }],
  };
  const data = asOpening(result, 240000);
  assert.equal(data.durationMs, 240000, 'the arc and the ending are the song\'s');
  assert.deepEqual(data.opening, { analyzedMs: 15000 });
  assert.equal(data.songProfile, result.songProfile, 'the world is chosen from the opening\'s own profile');
  assert.ok(data.barGrid.length > 100);
  assert.ok(data.energyCurves.sample(0, 60000) > 0.5, 'past the opening the energy holds rather than falling silent');

  // The picker and the running song hold this object; the upgrade lands on it.
  data.customBiome = { name: 'kept' };
  data.songIdentity = { seed: 7 };
  data.terrain = { range: { id: 'tetons' } };
  const full = { timeline: [{ tMs: 100 }, { tMs: 200000 }], durationMs: 240100, barGrid: [], songProfile: { version: 1, watch: { drive: 0.7 } } };
  const same = adoptFullAnalysis(data, full);
  assert.equal(same, data);
  assert.equal(data.timeline.length, 2);
  assert.equal(data.durationMs, 240100);
  assert.equal(data.opening, undefined, 'no longer an opening');
  assert.deepEqual([data.customBiome, data.songIdentity, data.terrain], [{ name: 'kept' }, { seed: 7 }, { range: { id: 'tetons' } }],
    'what was built on the opening is left as it is');
});

test('a cached whole-song analysis does not replace the identity the song already has', () => {
  const data = { opening: { analyzedMs: 15000 }, songIdentity: { seed: 7 } };
  adoptFullAnalysis(data, { timeline: [], fromBundle: true, songIdentity: null });
  assert.deepEqual(data.songIdentity, { seed: 7 });
  assert.equal(data.fromBundle, true, 'and is known to be cached, so it is not written back');
});
