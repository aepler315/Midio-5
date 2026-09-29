// Range v2 Task 13: an approval holds only for the assets it reviewed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, readAuthoring } from '../tools/build-range-scene.mjs';

test('the published catalog carries the approved pilot view with its evidence', async () => {
  const doc = await readAuthoring();
  const cat = await buildCatalog(doc);
  const v = cat.views.find((x) => x.id === 'nc-ross-lake-north');
  assert.equal(v.status, 'approved');
  assert.ok(v.evidence.approval.evidence.length >= 1);
  assert.ok(cat.catalogVersion >= 2);
});

test('an approval recorded against other assets ships the view as a candidate', async () => {
  const doc = await readAuthoring();
  const v = doc.views.find((x) => x.id === 'nc-ross-lake-north');
  const warn = console.warn; console.warn = () => {};
  try {
    for (const k of ['terrainManifestSha256', 'materialManifestSha256', 'cameraSha256']) {
      const stale = structuredClone(doc);
      stale.views.find((x) => x.id === v.id).approval[k] = '0'.repeat(64);
      const cat = await buildCatalog(stale);
      assert.equal(cat.views.find((x) => x.id === v.id).status, 'candidate', `${k} change must void the approval`);
    }
    const none = structuredClone(doc);
    delete none.views.find((x) => x.id === v.id).approval;
    assert.equal((await buildCatalog(none)).views.find((x) => x.id === v.id).status, 'candidate');
  } finally { console.warn = warn; }
});
