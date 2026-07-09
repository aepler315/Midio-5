// Minimal ZIP reader: central-directory walk + per-entry extraction.
// Supports method 0 (stored) and method 8 (deflate, via the browser's
// native DecompressionStream('deflate-raw')). Enough to pull .sf2 files
// out of a user-dropped archive without shipping a zip library.

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** List entries from the central directory: [{name, method, compSize, size, localOffset}] */
export function listZipEntries(buffer) {
  const view = new DataView(buffer);
  // EOCD lives in the last 65557 bytes; scan backward for its signature.
  const scanFrom = Math.max(0, buffer.byteLength - 65557);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory offset

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CDIR_SIG) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, nameLen));
    entries.push({ name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one entry to an ArrayBuffer. */
export async function extractZipEntry(buffer, entry) {
  const view = new DataView(buffer);
  const p = entry.localOffset;
  if (view.getUint32(p, true) !== LOCAL_SIG) throw new Error(`bad local header for ${entry.name}`);
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const dataStart = p + 30 + nameLen + extraLen;
  const comp = buffer.slice(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return comp;
  if (entry.method === 8) {
    const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }
  throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
}
