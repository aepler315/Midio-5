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

test('material overrides are part of the approved identity', async () => {
  const doc = await readAuthoring();
  const stale = structuredClone(doc);
  stale.views.find((x) => x.id === 'nc-ross-lake-north').materialRules = { snowlineM: 0, forestDensity: 0 };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await buildCatalog(stale)).views.find((x) => x.id === 'nc-ross-lake-north').status, 'candidate');
  } finally { console.warn = warn; }
});

test('the approval hashes the published terrain manifest itself', async () => {
  const { approvalHashes, RUNTIME_DIR } = await import('../tools/build-range-scene.mjs');
  const fs = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const doc = await readAuthoring();
  const v = doc.views.find((x) => x.id === 'nc-ross-lake-north');
  const onDisk = createHash('sha256').update(await fs.readFile(`${RUNTIME_DIR}/terrain/${v.id}.terrain.json`)).digest('hex');
  const h = await approvalHashes(v, { manifestSha256: 'f'.repeat(64), view: { camera: {} } });
  assert.equal(h.terrainManifestSha256, onDisk, 'not the build record copy');
});

test('approving requires existing evidence files', async () => {
  const { approveView } = await import('../tools/build-range-scene.mjs');
  const doc = await readAuthoring();
  await assert.rejects(approveView(structuredClone(doc), 'nc-ross-lake-north', { evidence: [] }), /evidence/);
  await assert.rejects(approveView(structuredClone(doc), 'nc-ross-lake-north', { evidence: ['docs/evidence/range-v2/missing.jpg'] }), /does not exist/);
});
