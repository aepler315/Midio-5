// Range v2 Task 7: one ledger for all Range graphics ownership.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsResidency, RESIDENCY_BUDGETS, LOW_MEMORY_BUDGETS, MiB, residencyBudgetFor } from '../src/render/GraphicsResidency.js';
import { TerrainStripCache } from '../src/world/terrain/TerrainStripCache.js';

const ledger = (mb = 100) => new GraphicsResidency({ budgetBytes: mb * MiB });

test('budgets match the plan', () => {
  assert.equal(RESIDENCY_BUDGETS.desktop, 512 * MiB);
  assert.equal(RESIDENCY_BUDGETS.mobile, 320 * MiB);
  assert.equal(LOW_MEMORY_BUDGETS.desktop, 256 * MiB);
  assert.equal(LOW_MEMORY_BUDGETS.mobile, 192 * MiB);
  assert.equal(residencyBudgetFor({ navigator: { deviceMemory: 4 } }).name, 'mobile');
  assert.equal(residencyBudgetFor({ navigator: { maxTouchPoints: 5 }, screen: { width: 390, height: 844 } }).name, 'mobile');
  assert.equal(residencyBudgetFor({ navigator: { deviceMemory: 16 }, screen: { width: 2560, height: 1440 } }).name, 'desktop');
});

test('budget size follows reported device memory', () => {
  const at = (nav, screen = { width: 2560, height: 1440 }) => residencyBudgetFor({ navigator: nav, screen }).bytes;
  const phone = { width: 412, height: 915 };
  assert.equal(at({ deviceMemory: 32 }), 512 * MiB, 'a 32 GB desktop');
  assert.equal(at({}), 512 * MiB, 'a desktop browser that does not report memory');
  assert.equal(at({ deviceMemory: 6 }), 256 * MiB, 'a desktop reporting under 8 GB');
  assert.equal(at({ deviceMemory: 8, maxTouchPoints: 5 }, phone), 320 * MiB, 'a phone reporting 8 GB');
  assert.equal(at({ maxTouchPoints: 5 }, phone), 192 * MiB, 'a phone that does not report memory');
  assert.equal(at({ deviceMemory: 4 }), 192 * MiB, 'any 4 GB device');
});

test('a denied reservation allocates nothing and evicts nothing', () => {
  const r = ledger(100);
  let disposed = 0;
  const a = r.reserve({ key: 'a', bytes: 60 * MiB, owner: 'terrain' });
  r.commit(a, {}, () => disposed++);
  r.pin(['a']);
  assert.equal(r.reserve({ key: 'b', bytes: 50 * MiB, owner: 'terrain' }), null);
  assert.equal(disposed, 0);
  assert.equal(r.has('b'), false);
  assert.equal(r.snapshot().denials, 1);
});

test('pending -> live is not double counted', () => {
  const r = ledger(100);
  const res = r.reserve({ key: 'k', bytes: 40 * MiB, owner: 'o' });
  assert.equal(r.pendingBytes, 40 * MiB);
  assert.equal(r.liveBytes, 0);
  assert.equal(r.commit(res, { gpu: true }), true);
  assert.equal(r.pendingBytes, 0);
  assert.equal(r.liveBytes, 40 * MiB);
  assert.equal(r.usedBytes, 40 * MiB);
  assert.throws(() => r.reserve({ key: 'k', bytes: 1, owner: 'o' }), /already exists/);
});

test('pinned objects survive eviction; unpinned LRU go first', () => {
  const r = ledger(100);
  const disposed = [];
  for (const k of ['old', 'mid', 'pinned']) r.commit(r.reserve({ key: k, bytes: 30 * MiB, owner: 'o' }), k, (x) => disposed.push(x));
  r.get('mid'); // touch
  r.pin(['pinned']);
  assert.ok(r.reserve({ key: 'new', bytes: 40 * MiB, owner: 'o' }));
  assert.deepEqual(disposed, ['old']);
  assert.ok(r.has('pinned') && r.has('mid'));
});

test('cancelling a generation voids pending work and releases its reservations', () => {
  const r = ledger(100);
  const res = r.reserve({ key: 'late', bytes: 50 * MiB, owner: 'o', generation: 3 });
  r.cancelGeneration(3);
  assert.equal(r.usedBytes, 0, 'cancelled pending bytes are freed at once');
  let disposed = false;
  assert.equal(r.commit(res, { stale: true }, () => { disposed = true; }), false, 'late commit is not published');
  assert.equal(disposed, true);
  assert.equal(r.has('late'), false);
  assert.equal(r.reserve({ key: 'again', bytes: 1, owner: 'o', generation: 3 }), null);
  assert.deepEqual(r.snapshot().cancelledGenerations, [3]);
});

test('release and dispose are idempotent', () => {
  const r = ledger(10);
  let n = 0;
  r.commit(r.reserve({ key: 'x', bytes: MiB, owner: 'o' }), {}, () => n++);
  assert.equal(r.release('x'), true);
  assert.equal(r.release('x'), false);
  assert.equal(n, 1);
  assert.equal(r.usedBytes, 0);
});

test('snapshot reports ownership by owner, pins and cancellations', () => {
  const r = ledger(100);
  r.commit(r.reserve({ key: 'g', bytes: 10 * MiB, owner: 'gpu' }), {});
  r.reserve({ key: 'c', bytes: 5 * MiB, owner: 'cpu' });
  r.pin(['g']);
  const s = r.snapshot();
  assert.deepEqual(s.byOwner.gpu, { pending: 0, live: 10 * MiB, count: 1 });
  assert.deepEqual(s.byOwner.cpu, { pending: 5 * MiB, live: 0, count: 1 });
  assert.deepEqual(s.pinned, ['g']);
  assert.equal(s.entryCount, 2);
  assert.deepEqual(s.generations, [0]);
  r.reserve({ key: 'n', bytes: MiB, owner: 'gpu', generation: 3 });
  assert.deepEqual(r.snapshot().generations, [0, 3]);
});

test('legacy strips share the ledger instead of a second allowance', () => {
  const r = ledger(10);
  const canvas = (w, h) => ({ width: w, height: h });
  const cache = new TerrainStripCache({ maxBytes: 100 * MiB, residency: r, owner: 'legacy' });
  // Another owner already holds 8 MiB of the 10 MiB ledger.
  r.commit(r.reserve({ key: 'scene', bytes: 8 * MiB, owner: 'range' }), {});
  r.pin(['scene']);
  assert.equal(cache.reserve(4 * MiB), false, 'strip cache must respect the shared budget');
  cache.set('A', { L2: canvas(512, 512) }); // 1 MiB, adopted truthfully
  assert.equal(r.snapshot().byOwner.legacy.live, MiB);
  cache.delete('A');
  assert.equal(r.snapshot().byOwner.legacy, undefined);
});

test('a strip reservation really evicts an unpinned entry instead of overcommitting', () => {
  const r = ledger(10);
  const canvas = (w, h) => ({ width: w, height: h });
  const cache = new TerrainStripCache({ maxBytes: 100 * MiB, residency: r, owner: 'legacy' });
  let disposed = false;
  r.commit(r.reserve({ key: 'scene', bytes: 8 * MiB, owner: 'range' }), {}, () => { disposed = true; });
  assert.equal(cache.reserve(4 * MiB), true);
  assert.equal(disposed, true, 'the evictable scene was released to make room');
  assert.ok(r.usedBytes <= 10 * MiB);
  cache.set('A', { L2: canvas(1024, 1024) }); // 4 MiB
  assert.equal(r.snapshot().byOwner.legacy.live, 4 * MiB);
  assert.equal(r.overcommits || 0, 0);
  assert.ok(r.usedBytes <= 10 * MiB);
});

test('inserting strips without a hold claims room first, and only an impossible fit overcommits', () => {
  const canvas = (w, h) => ({ width: w, height: h });
  // Room can be made: the unpinned scene is evicted, no overcommit.
  let r = ledger(10);
  let cache = new TerrainStripCache({ maxBytes: 100 * MiB, residency: r, owner: 'legacy' });
  r.commit(r.reserve({ key: 'scene', bytes: 8 * MiB, owner: 'range' }), {});
  cache.set('A', { L2: canvas(1024, 1024) }); // 4 MiB, no reserve() first
  assert.equal(r.snapshot().byOwner.range, undefined);
  assert.equal(r.overcommits || 0, 0);
  assert.equal(cache.overBudget || 0, 0);
  // No room can be made (the scene is pinned): recorded, not hidden.
  r = ledger(10);
  cache = new TerrainStripCache({ maxBytes: 100 * MiB, residency: r, owner: 'legacy' });
  r.commit(r.reserve({ key: 'scene', bytes: 8 * MiB, owner: 'range' }), {});
  r.pin(['scene']);
  const warn = console.warn; console.warn = () => {};
  try { cache.set('A', { L2: canvas(1024, 1024) }); } finally { console.warn = warn; }
  assert.equal(cache.overBudget, 1);
  assert.equal(r.overcommits, 1);
});

test('fallback strips (a biome Range v2 draws) are evictable by the scene; others are not', () => {
  const r = ledger(10);
  const canvas = (w, h) => ({ width: w, height: h });
  const cache = new TerrainStripCache({ maxBytes: 100 * MiB, residency: r, owner: 'legacy', isFallback: (k) => k === 'COVERED' });
  cache.set('COVERED', { L2: canvas(1024, 1024) }); // 4 MiB, fallback
  cache.set('LEGACY', { L2: canvas(1024, 1024) }); // 4 MiB, the only scenery for its biome
  // The scene reserves 5 MiB: only the fallback set may go.
  assert.ok(r.reserve({ key: 'scene', bytes: 5 * MiB, owner: 'range' }));
  assert.equal(cache.has('COVERED'), false, 'the cache forgets what the ledger evicted');
  assert.equal(cache.has('LEGACY'), true);
  assert.equal(cache.bytes, 4 * MiB);
  // Nothing more may be taken from legacy-only scenery.
  assert.equal(r.reserve({ key: 'more', bytes: 3 * MiB, owner: 'range' }), null);
  // A delete of our own releases once and does not recurse.
  cache.delete('LEGACY');
  assert.equal(cache.bytes, 0);
  assert.equal(r.snapshot().byOwner.legacy, undefined);
});

test('the high-water mark catches ownership that peaks and falls between samples', () => {
  const r = ledger(100);
  r.commit(r.reserve({ key: 'view', bytes: 30 * MiB, owner: 'terrain' }), {});
  // A scratch buffer reserved and released inside one task.
  r.reserve({ key: 'scratch', bytes: 40 * MiB, owner: 'scratch' });
  r.release('scratch');
  const s = r.snapshot();
  assert.equal(s.liveBytes + s.pendingBytes, 30 * MiB);
  assert.equal(s.peakBytes, 70 * MiB);
  assert.deepEqual(s.peakByOwner, { terrain: 30 * MiB, scratch: 40 * MiB });
  r.resetPeak();
  assert.equal(r.snapshot().peakBytes, 30 * MiB, 'a new window starts from what is held now');
  r.adopt({ key: 'strip', bytes: 5 * MiB, owner: 'legacy' });
  assert.equal(r.snapshot().peakBytes, 35 * MiB, 'adopted memory counts too');
});

test('releasing decode scratch lowers a live charge without allowing unreserved growth', () => {
 const r=ledger(10),slot=r.reserve({key:'cpu',bytes:8*MiB,owner:'terrain',generation:1});r.commit(slot,{});
 assert.equal(r.shrink('cpu',3*MiB),true);assert.equal(r.liveBytes,3*MiB);assert.equal(r.shrink('cpu',12*MiB),false);assert.equal(r.liveBytes,3*MiB);assert.equal(r.snapshot().peakBytes,8*MiB);
});
