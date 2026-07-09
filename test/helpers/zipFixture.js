// Minimal zip writer for fixtures: entries = [{name, data:Uint8Array, method}]
// method 0 = stored, 8 = deflate (compressed here via node:zlib).
import { deflateRawSync } from 'node:zlib';

const enc = new TextEncoder();

export function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const comp = e.method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, comp.length, true);  // compressed size
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, comp);

    const cdir = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdir.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);       // local header offset
    cdir.set(nameBytes, 46);
    central.push(cdir);

    offset += local.length + comp.length;
  }

  const cdirBytes = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);  // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdirBytes, true);
  ev.setUint32(16, offset, true);         // central directory offset
  parts.push(...central, eocd);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}
