import test from 'node:test';
import assert from 'node:assert/strict';
import { assertActualDpr, claimCase, verifyServedIdentity } from '../tools/lib/landscape-evidence.mjs';
import { caseId, casesForPreset, requireBiomes } from '../tools/lib/landscape-fixtures.mjs';
import { parseLandscapeArgs } from '../tools/range-landscape-smoke.mjs';

test('verifyServedIdentity rejects a module hash even when the commit string matches', () => {
  const expectSha = 'e4a0e81ea8263579f68fbb32d382db111531cc7c';
  assert.throws(() => verifyServedIdentity({
    expectSha,
    expectedHashes: { 'src/world/BiomeManager.js': 'abc' },
    served: { commit: expectSha, hashes: { 'src/world/BiomeManager.js': 'def' } },
  }), /BiomeManager/);
  assert.equal(verifyServedIdentity({
    expectSha,
    expectedHashes: { 'src/world/BiomeManager.js': 'abc' },
    served: { commit: expectSha, hashes: { 'src/world/BiomeManager.js': 'abc' } },
  }), true);
});

test('a missing required biome fails the preset', () => {
  assert.throws(() => requireBiomes(['RAINFOREST', 'DESERT']), /ICEFIELD/);
  assert.doesNotThrow(() => requireBiomes([
    'ICEFIELD', 'TUNDRA', 'TAIGA', 'RAINFOREST', 'CONIFER', 'PINE_OAK',
    'BROADLEAF', 'CHAPARRAL', 'STEPPE', 'CANYON', 'DESERT',
  ]));
});

test('actual DPR and duplicate case ids are rejected', () => {
  assert.throws(() => assertActualDpr(2, 1), /devicePixelRatio/);
  const seen = new Set();
  const spec = { biome: 'DESERT', seed: 315, timeMs: 45000, level: 0, reducedFlash: false, width: 1280, height: 720, dpr: 1, pass: 'all' };
  claimCase(seen, caseId(spec, { fixtureHash: 'h' }));
  assert.throws(() => claimCase(seen, caseId(spec, { fixtureHash: 'h' })), /duplicate/);
  assert.throws(() => casesForPreset('not-a-preset'), /unknown landscape preset/);
  assert.equal(casesForPreset('primary').length, 11);
  assert.throws(() => parseLandscapeArgs(['node', 'smoke', '--preset', 'primary']), /require --url/);
  assert.throws(() => parseLandscapeArgs(['node', 'smoke', '--url', 'http://127.0.0.1:8091', '--source-root', '.', '--expect-sha', 'abc', '--nope', '1']), /unknown landscape flag/);
  const parsed = parseLandscapeArgs(['node', 'smoke', '--url', 'http://127.0.0.1:8091', '--source-root', '.', '--expect-sha', 'abc', '--preset', 'primary', '--output', '.smoke/out']);
  assert.equal(parsed.preset, 'primary');
  assert.equal(parseLandscapeArgs(['node', 'smoke', 'http://127.0.0.1:8080', 'out', 'base']).legacy, true);
});
