const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the small, public navigation manifest without fetching build reports. */
export function validateVersionManifest(value) {
  if (!isRecord(value) || value.schema !== 1) throw new Error('Unsupported version manifest schema.');
  if (typeof value.buildSha !== 'string' || !SHA.test(value.buildSha)) throw new Error('Invalid build SHA.');
  if (typeof value.liveId !== 'string' || !ID.test(value.liveId)) throw new Error('Invalid live checkpoint ID.');
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new Error('Version entries are required.');
  const seen = new Set();
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !ID.test(entry.id)) throw new Error('Invalid checkpoint ID.');
    if (seen.has(entry.id)) throw new Error(`Duplicate checkpoint ID: ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw new Error('Invalid checkpoint label.');
    if (typeof entry.sourceSha !== 'string' || !SHA.test(entry.sourceSha)) throw new Error('Invalid source SHA.');
    if (!Number.isSafeInteger(entry.sourcePr) || entry.sourcePr <= 0) throw new Error('Invalid source PR.');
    if (typeof entry.live !== 'boolean') throw new Error('Invalid live flag.');
    return { id: entry.id, label: entry.label, sourceSha: entry.sourceSha,
      sourcePr: entry.sourcePr, entryPath: entry.entryPath, live: entry.live };
  });
  const live = entries.filter((entry) => entry.live);
  if (live.length !== 1 || live[0].id !== value.liveId) throw new Error('Manifest must identify exactly one matching live checkpoint.');
  for (const entry of entries) {
    // Exact generated paths exclude traversal, encoding, URL schemes,
    // credentials, query flags and redirects to a different checkpoint.
    const expected = entry.live ? './' : `versions/${entry.id}/`;
    if (entry.entryPath !== expected) throw new Error(`Invalid entry path for checkpoint: ${entry.id}`);
    Object.freeze(entry);
  }
  return Object.freeze({ schema: 1, buildSha: value.buildSha, liveId: value.liveId,
    entries: Object.freeze(entries) });
}

function findEntry(manifest, id) {
  const index = manifest.entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new Error(`Unknown checkpoint ID: ${id}`);
  return index;
}

/** Neighbors retain authored visual order; endpoints never wrap. */
export function getVersionNeighbors(value, id) {
  const manifest = validateVersionManifest(value);
  const index = findEntry(manifest, id);
  return { previous: manifest.entries[index - 1] || null, next: manifest.entries[index + 1] || null };
}

/** Resolve only catalog destinations against trusted, site-root metadata. */
export function resolveVersionUrl(value, id, siteRoot) {
  const manifest = validateVersionManifest(value);
  const entry = manifest.entries[findEntry(manifest, id)];
  let root;
  try { root = new URL(siteRoot); } catch { throw new Error('Invalid site root URL.'); }
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password
    || root.search || root.hash || !root.pathname.endsWith('/')) throw new Error('Invalid site root directory.');
  const currentOrigin = globalThis.location?.origin;
  if (currentOrigin && root.origin !== currentOrigin) throw new Error('Site root must use the current origin.');
  const destination = new URL(entry.entryPath, root);
  if (destination.origin !== root.origin || !destination.pathname.startsWith(root.pathname)) {
    throw new Error('Version destination leaves the site root.');
  }
  return destination;
}
