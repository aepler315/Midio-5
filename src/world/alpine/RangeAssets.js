// Range v2 asset preparation: verified, cancelable loading of one view's
// terrain package (plan §7.1-7.4, Task 7). Nothing here touches the GPU;
// RangeScene uploads what this returns. Every byte is checked against the
// manifest (length + SHA-256) and the manifest itself is validated before
// any buffer is interpreted.
import { validateTerrainManifest } from './TerrainPackage.js';
import { decodeTerrain } from './TerrainMesh.js';

export class RangeAssetError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'RangeAssetError';
    this.reason = reason; // 'http' | 'hash' | 'manifest' | 'decode' | 'aborted' | 'stale' | 'budget' | 'context-lost'
  }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new RangeAssetError('hash', 'SubtleCrypto unavailable');
  return hex(await subtle.digest('SHA-256', bytes));
}

async function fetchBytes(url, { signal, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw new RangeAssetError('aborted', `aborted: ${url}`);
    throw new RangeAssetError('http', `fetch failed for ${url}: ${err?.message || err}`);
  }
  if (!res.ok) throw new RangeAssetError('http', `HTTP ${res.status} for ${url}`);
  // The body streams after the headers: an abort or a dropped connection
  // there must still surface as a classified asset error.
  let buf;
  try {
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (signal?.aborted) throw new RangeAssetError('aborted', `aborted: ${url}`);
    throw new RangeAssetError('http', `body read failed for ${url}: ${err?.message || err}`);
  }
  if (signal?.aborted) throw new RangeAssetError('aborted', `aborted: ${url}`);
  return buf;
}

/** Gunzip with the platform's DecompressionStream. A host that already
 *  decoded the transfer (Content-Encoding: gzip) hands back raw bytes; the
 *  gzip magic number tells the two apart. */
export async function gunzip(bytes) {
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new RangeAssetError('decode', 'DecompressionStream unavailable');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Load, verify and decode one terrain package.
 *   manifestUrl  URL of <view>.terrain.json; the payload URL is relative to it
 *   options      { signal, fetchImpl, expectManifestSha256 }
 * Resolves { manifest, data (TerrainMesh decode), bytes: { compressed, decoded } }.
 */
export async function loadTerrainPackage(manifestUrl, { signal = null, fetchImpl, expectManifestSha256 = null } = {}) {
  const manifestBytes = await fetchBytes(manifestUrl, { signal, fetchImpl });
  if (expectManifestSha256) {
    const got = await sha256Hex(manifestBytes);
    if (got !== expectManifestSha256) throw new RangeAssetError('hash', `manifest hash ${got} != ${expectManifestSha256}`);
  }
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); }
  catch { throw new RangeAssetError('manifest', `manifest is not JSON: ${manifestUrl}`); }
  const shape = validateTerrainManifest(manifest);
  if (!shape.ok) throw new RangeAssetError('manifest', `manifest rejected: ${shape.errors.slice(0, 3).join('; ')}`);
  const payloadUrl = new URL(manifest.payload.url, new URL(manifestUrl, globalThis.location?.href || 'http://localhost/')).href;
  const compressed = await fetchBytes(payloadUrl, { signal, fetchImpl });
  let decoded;
  if (compressed[0] === 0x1f && compressed[1] === 0x8b) {
    if (compressed.byteLength !== manifest.payload.byteLength) {
      throw new RangeAssetError('hash', `payload length ${compressed.byteLength} != ${manifest.payload.byteLength}`);
    }
    const got = await sha256Hex(compressed);
    if (got !== manifest.payload.sha256) throw new RangeAssetError('hash', 'payload hash mismatch');
    try { decoded = await gunzip(compressed); }
    catch (err) { throw new RangeAssetError('decode', `payload decode failed: ${err?.message || err}`); }
  } else {
    decoded = compressed; // transfer-decoded by the host; verify the decoded identity instead
  }
  if (signal?.aborted) throw new RangeAssetError('aborted', 'aborted after download');
  if (decoded.byteLength !== manifest.payload.decodedByteLength) {
    throw new RangeAssetError('hash', `decoded length ${decoded.byteLength} != ${manifest.payload.decodedByteLength}`);
  }
  const decodedSha = await sha256Hex(decoded);
  if (decodedSha !== manifest.payload.decodedSha256) throw new RangeAssetError('hash', 'decoded payload hash mismatch');
  const check = validateTerrainManifest(manifest, { decoded: decoded.byteLength });
  if (!check.ok) throw new RangeAssetError('manifest', check.errors.slice(0, 3).join('; '));
  let data;
  try { data = decodeTerrain(manifest, decoded); }
  catch (err) { throw new RangeAssetError('decode', err?.message || String(err)); }
  return { manifest, data, bytes: { compressed: compressed.byteLength, decoded: decoded.byteLength }, identity: { payloadSha256: manifest.payload.sha256, decodedSha256: decodedSha } };
}

/** Decoded CPU bytes a terrain package will own: payload (compressed +
 *  decoded while decoding) plus Float32 heights, flow and validity bytes. */
export function terrainCpuBytes(manifest) {
  let samples = 0;
  for (const t of manifest.tiles) samples += t.samples * t.samples;
  return manifest.payload.byteLength + manifest.payload.decodedByteLength + samples * (4 + 1 + 1);
}

/**
 * Prepare one view's terrain under a residency ledger and a generation.
 *   view       SceneView (catalog entry)
 *   options    { baseUrl, residency, generation, signal, isCurrent, fetchImpl }
 * Reuses an already-live preparation. Reserves CPU ownership after reading
 * the (small) manifest and before downloading/decoding the payload; a
 * denial throws RangeAssetError('budget') having allocated nothing. After
 * every await the generation is re-checked: a stale result is released,
 * never published into a newer song or world.
 */
export async function prepareTerrainAssets(view, {
  baseUrl, residency, generation = 0, signal = null, isCurrent = () => true, fetchImpl,
} = {}) {
  const key = `range:terrain-cpu:${view.id}`;
  const live = residency?.get(key);
  if (live) return live;
  const manifestUrl = new URL(view.terrainManifestUrl, baseUrl).href;
  const stale = () => signal?.aborted || !isCurrent(generation);
  const manifestBytes = await fetchBytes(manifestUrl, { signal, fetchImpl });
  if (stale()) throw new RangeAssetError('stale', `stale generation ${generation} for ${view.id}`);
  if (view.terrainManifestSha256) {
    const got = await sha256Hex(manifestBytes);
    if (got !== view.terrainManifestSha256) throw new RangeAssetError('hash', `${view.id} manifest ${got} is not the catalog's ${view.terrainManifestSha256}`);
  }
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); }
  catch { throw new RangeAssetError('manifest', `manifest is not JSON: ${manifestUrl}`); }
  const shape = validateTerrainManifest(manifest);
  if (!shape.ok) throw new RangeAssetError('manifest', `manifest rejected: ${shape.errors.slice(0, 3).join('; ')}`);
  if (manifest.viewId !== view.id) throw new RangeAssetError('manifest', `manifest is for ${manifest.viewId}, not ${view.id}`);
  const reservation = residency
    ? residency.reserve({ key, bytes: terrainCpuBytes(manifest), owner: 'range-terrain-cpu', generation })
    : null;
  if (residency && !reservation) throw new RangeAssetError('budget', `no room for ${view.id} terrain`);
  try {
    // The manifest is already verified; load the payload through the same path.
    const pkg = await loadTerrainPackage(manifestUrl, {
      signal, fetchImpl: async (url, init) => (url === manifestUrl
        ? new Response(manifestBytes) : (fetchImpl || globalThis.fetch)(url, init)),
    });
    if (stale()) throw new RangeAssetError('stale', `stale generation ${generation} for ${view.id}`);
    const prepared = { viewId: view.id, generation, key, ...pkg };
    if (reservation && !residency.commit(reservation, prepared, null)) {
      throw new RangeAssetError('stale', `generation ${generation} cancelled during ${view.id}`);
    }
    return prepared;
  } catch (err) {
    if (reservation) residency.release(key);
    throw err instanceof RangeAssetError ? err : new RangeAssetError('decode', err?.message || String(err));
  }
}
