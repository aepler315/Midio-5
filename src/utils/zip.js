// Minimal ZIP extractor: EOCD scan → central-directory walk; stored (method 0)
// and deflate (method 8) via DecompressionStream('deflate-raw'). Returns a
// Map<filename, Uint8Array> of every regular file in the archive.
// Works in the browser (from SoundfontLibrary .zip upload) and in Node 18+
// (for unit tests) — both provide DecompressionStream, Blob, and Response
// as globals.

const EOCD_SIG = 0x06054b50; // "PK\x05\x06"
const CDH_SIG = 0x02014b50;  // "PK\x01\x02"
const LFH_SIG = 0x04034b50;  // "PK\x03\x04"

function findEocd(buf) {
  // The EOCD record is at least 22 bytes, but a comment of up to 65535 bytes
  // may follow it, so scan backwards from the very end.
  const minEocd = 22;
  const maxComment = 0xffff;
  const scanStart = Math.max(0, buf.byteLength - minEocd - maxComment);
  for (let i = buf.byteLength - minEocd; i >= scanStart; i--) {
    if (
      buf[i] === 0x50 && buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 && buf[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract all regular files from a ZIP archive.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<Map<string, Uint8Array>>} filename → decompressed bytes
 */
export async function extractZip(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const eocdOff = findEocd(buf);
  if (eocdOff < 0) throw new Error('zip: EOCD signature not found');

  const cdCount = dv.getUint16(eocdOff + 10, true);
  const cdOff = dv.getUint32(eocdOff + 16, true);

  const files = new Map();
  let ptr = cdOff;

  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(ptr, true) !== CDH_SIG) break;

    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);

    const name = new TextDecoder().decode(
      buf.subarray(ptr + 46, ptr + 46 + nameLen),
    );

    const entryEnd = ptr + 46 + nameLen + extraLen + commentLen;

    // Skip directory entries (name ends with /)
    if (name.endsWith('/')) {
      ptr = entryEnd;
      continue;
    }

    // Read local header to find actual data offset
    if (dv.getUint32(localOff, true) !== LFH_SIG) {
      ptr = entryEnd;
      continue;
    }
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const compressed = buf.subarray(dataOff, dataOff + compSize);

    if (method === 0) {
      // Stored — no compression
      files.set(name, new Uint8Array(compressed));
    } else if (method === 8) {
      // Deflate via Web Streams API (browser + Node 18+)
      const ds = new DecompressionStream('deflate-raw');
      const blob = new Blob([compressed]);
      const stream = blob.stream().pipeThrough(ds);
      const decompressed = await new Response(stream).arrayBuffer();
      files.set(name, new Uint8Array(decompressed));
    } else {
      // Unsupported compression — skip quietly
      ptr = entryEnd;
      continue;
    }

    ptr = entryEnd;
  }

  return files;
}