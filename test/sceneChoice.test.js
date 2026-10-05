import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO, BIOME_CHOICE_KEY, RANGE_CHOICE_KEY, pickableViews, resolveSceneChoice, searchWithSceneChoice, viewLabel, writeSceneChoice,
} from '../src/ui/SceneChoice.js';
import SCENE_CATALOG from '../src/world/terrain/sceneCatalogData.js';
import { REAL_BIOME_NAMES } from '../src/world/RealBiomes.js';
import { prepareSongTerrain } from '../src/world/terrain/RangeLibrary.js';
import { RangePresentation } from '../src/world/alpine/RangePresentation.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}
const base = { catalog: SCENE_CATALOG, biomeNames: REAL_BIOME_NAMES };

test('Auto by default: nothing linked, nothing remembered', () => {
  assert.deepEqual(resolveSceneChoice({ ...base, search: '', storage: memoryStorage() }),
    { viewId: null, biome: null, source: null });
});

test('a range brings its own biome, whatever biome is asked for', () => {
  const c = resolveSceneChoice({ ...base, search: '?range=tombstone-north-klondike&biome=DESERT', storage: null });
  assert.deepEqual(c, { viewId: 'tombstone-north-klondike', biome: 'TUNDRA', source: 'link' });
});

test('a biome alone pins the biome; names are case-insensitive', () => {
  const c = resolveSceneChoice({ ...base, search: '?biome=canyon', storage: null });
  assert.deepEqual(c, { viewId: null, biome: 'CANYON', source: 'link' });
});

test('unknown names fall back to Auto', () => {
  assert.equal(resolveSceneChoice({ ...base, search: '?range=nowhere', storage: null }).viewId, null);
  assert.equal(resolveSceneChoice({ ...base, search: '?biome=MOON', storage: null }).biome, null);
});

test('every catalog view is pickable, candidates included and labelled', () => {
  const views = pickableViews(SCENE_CATALOG);
  assert.equal(views.length, SCENE_CATALOG.views.length);
  assert.equal(resolveSceneChoice({ ...base, search: '?range=pend-oreille-valley', storage: null }).viewId,
    'pend-oreille-valley');
  assert.equal(resolveSceneChoice({ ...base, search: '?rangeView=pend-oreille-valley', storage: null }).viewId,
    'pend-oreille-valley');
  const labels = views.map((v) => viewLabel(v));
  assert.equal(new Set(labels).size, labels.length, 'two views share a menu label');
  assert.match(viewLabel(SCENE_CATALOG.views.find((v) => v.id === 'teton-jackson-lake-coherent')), /unreviewed, alternate/);
  assert.equal(viewLabel(SCENE_CATALOG.views.find((v) => v.id === 'teton-jackson-lake'), 'Conifer'), 'Teton Range · Conifer');
});

test('remembered choice applies when the link names none; a link wins over it', () => {
  const storage = memoryStorage();
  writeSceneChoice({ viewId: 'teton-jackson-lake', biome: 'CONIFER' }, storage);
  assert.deepEqual(storage.dump(), { [RANGE_CHOICE_KEY]: 'teton-jackson-lake' });
  assert.deepEqual(resolveSceneChoice({ ...base, search: '?worlds=all', storage }),
    { viewId: 'teton-jackson-lake', biome: 'CONIFER', source: 'remembered' });
  assert.deepEqual(resolveSceneChoice({ ...base, search: '?biome=DESERT', storage }),
    { viewId: null, biome: 'DESERT', source: 'link' });
  writeSceneChoice({ viewId: null, biome: AUTO }, storage);
  assert.deepEqual(storage.dump(), {});
  writeSceneChoice({ biome: 'STEPPE' }, storage);
  assert.equal(storage.dump()[BIOME_CHOICE_KEY], 'STEPPE');
});

test('blocked storage reads as Auto and writes nothing', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(resolveSceneChoice({ ...base, search: '', storage: throwing }).viewId, null);
  assert.doesNotThrow(() => writeSceneChoice({ viewId: 'teton-jackson-lake' }, throwing));
});

test('the address bar carries the choice and keeps other parameters', () => {
  assert.equal(searchWithSceneChoice('?worlds=all&rangeView=x', { viewId: 'denali-wonder-lake', biome: 'ICEFIELD' }),
    '?worlds=all&range=denali-wonder-lake');
  assert.equal(searchWithSceneChoice('?range=a', { biome: 'TAIGA' }), '?biome=TAIGA');
  assert.equal(searchWithSceneChoice('?range=a&biome=B', {}), '');
});

test('a pinned biome keeps the whole song in it', async () => {
  const profile = { version: 1, energy: 0.5 };
  const t = await prepareSongTerrain(profile, 4242, [], { biome: 'CANYON' });
  assert.ok(t, 'terrain prepared');
  assert.deepEqual(t.biomes, ['CANYON']);
  assert.equal(t.home, 'CANYON');
  assert.equal(t.sceneByBiome.get('CANYON')?.view?.biome, 'CANYON');
});

test('the presentation takes a forced view between songs and can let it go', () => {
  const p = new RangePresentation({ mode: 'v2', catalog: SCENE_CATALOG });
  assert.equal(p.forced, null);
  p.setForcedView('muncho-lake-south');
  assert.equal(p.forced.view.id, 'muncho-lake-south');
  assert.equal(p.forced.forcedCandidate, false);
  p.setForcedView(null);
  assert.equal(p.forced, null);
  assert.equal(p.forcedViewId, null);
});
