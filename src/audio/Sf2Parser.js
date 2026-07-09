// A pragmatic SoundFont 2 parser: RIFF walk -> sample data + a flattened
// zone table per (bank, program). Deliberately a playback subset, not a
// spec-complete reader: key/vel ranges, sample addressing + loops, the
// volume envelope, tuning, and attenuation -- the generators that decide
// what you hear. Modulators, filters, LFOs, and stereo links are ignored.

const GEN = {
  START_OFS: 0, END_OFS: 1, LOOPSTART_OFS: 2, LOOPEND_OFS: 3,
  ATTACK: 34, HOLD: 35, DECAY: 36, SUSTAIN: 37, RELEASE: 38,
  INSTRUMENT: 41, KEY_RANGE: 43, VEL_RANGE: 44, ATTENUATION: 48,
  COARSE_TUNE: 51, FINE_TUNE: 52, SAMPLE_ID: 53, SAMPLE_MODES: 54,
  ROOT_KEY: 58,
};

const tc2sec = (tc) => Math.pow(2, tc / 1200); // timecents -> seconds
const readName = (bytes, off) => {
  let s = '';
  for (let i = 0; i < 20; i++) { const c = bytes[off + i]; if (!c) break; s += String.fromCharCode(c); }
  return s.trim();
};

export function parseSf2(buffer, fallbackName = 'soundfont') {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const tag = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('not an sf2 file');

  // Walk the top-level LIST chunks and collect the sub-chunks we need.
  const chunks = {}; // id -> {offset, size} (pdta sub-chunks + smpl)
  let name = fallbackName;
  let p = 12;
  while (p + 8 <= buffer.byteLength) {
    const id = tag(p);
    const size = view.getUint32(p + 4, true);
    if (id === 'LIST') {
      const listType = tag(p + 8);
      let q = p + 12;
      const end = p + 8 + size;
      while (q + 8 <= end) {
        const cid = tag(q);
        const csize = view.getUint32(q + 4, true);
        if (listType === 'sdta' && cid === 'smpl') chunks.smpl = { offset: q + 8, size: csize };
        if (listType === 'pdta') chunks[cid] = { offset: q + 8, size: csize };
        if (listType === 'INFO' && cid === 'INAM') {
          name = new TextDecoder().decode(bytes.subarray(q + 8, q + 8 + csize)).replace(/\0.*$/, '').trim() || fallbackName;
        }
        q += 8 + csize + (csize & 1);
      }
    }
    p += 8 + size + (size & 1);
  }
  for (const need of ['smpl', 'phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr']) {
    if (!chunks[need]) throw new Error(`sf2 missing ${need} chunk`);
  }

  // 16-bit PCM sample pool.
  const sampleData = new Int16Array(buffer, chunks.smpl.offset, Math.floor(chunks.smpl.size / 2));

  // shdr: sample headers.
  const samples = [];
  for (let o = chunks.shdr.offset; o + 46 <= chunks.shdr.offset + chunks.shdr.size; o += 46) {
    samples.push({
      name: readName(bytes, o),
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      loopStart: view.getUint32(o + 28, true),
      loopEnd: view.getUint32(o + 32, true),
      sampleRate: view.getUint32(o + 36, true) || 44100,
      originalKey: bytes[o + 40] <= 127 ? bytes[o + 40] : 60,
      correction: view.getInt8(o + 41),
      type: view.getUint16(o + 44, true),
    });
  }
  samples.pop(); // terminal EOS record

  const readBags = (c) => {
    const out = [];
    for (let o = c.offset; o + 4 <= c.offset + c.size; o += 4) out.push(view.getUint16(o, true));
    return out; // genIdx stream (we ignore modIdx)
  };
  const readGens = (c) => {
    const out = [];
    for (let o = c.offset; o + 4 <= c.offset + c.size; o += 4) {
      out.push({ op: view.getUint16(o, true), raw: view.getUint16(o + 2, true), amt: view.getInt16(o + 2, true) });
    }
    return out;
  };
  const pbag = readBags(chunks.pbag), pgen = readGens(chunks.pgen);
  const ibag = readBags(chunks.ibag), igen = readGens(chunks.igen);

  // inst: instrument -> flattened zones (global zone folded in).
  const instruments = [];
  const instRecords = [];
  for (let o = chunks.inst.offset; o + 22 <= chunks.inst.offset + chunks.inst.size; o += 22) {
    instRecords.push({ name: readName(bytes, o), bagIdx: view.getUint16(o + 20, true) });
  }
  for (let i = 0; i < instRecords.length - 1; i++) {
    const zones = [];
    let global = null;
    for (let b = instRecords[i].bagIdx; b < instRecords[i + 1].bagIdx; b++) {
      const gens = igen.slice(ibag[b], ibag[b + 1] ?? igen.length);
      const zone = global ? { ...global } : {
        keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, sampleIdx: -1, rootKey: -1,
        startOfs: 0, endOfs: 0, loopStartOfs: 0, loopEndOfs: 0, modes: 0,
        attack: 0.002, hold: 0, decay: 0.4, sustain: 1, release: 0.25,
        attenuation: 0, coarse: 0, fine: 0,
      };
      for (const g of gens) {
        switch (g.op) {
          case GEN.KEY_RANGE: zone.keyLo = g.raw & 0xff; zone.keyHi = (g.raw >> 8) & 0xff; break;
          case GEN.VEL_RANGE: zone.velLo = g.raw & 0xff; zone.velHi = (g.raw >> 8) & 0xff; break;
          case GEN.SAMPLE_ID: zone.sampleIdx = g.raw; break;
          case GEN.ROOT_KEY: zone.rootKey = g.amt; break;
          case GEN.START_OFS: zone.startOfs = g.amt; break;
          case GEN.END_OFS: zone.endOfs = g.amt; break;
          case GEN.LOOPSTART_OFS: zone.loopStartOfs = g.amt; break;
          case GEN.LOOPEND_OFS: zone.loopEndOfs = g.amt; break;
          case GEN.SAMPLE_MODES: zone.modes = g.raw & 3; break;
          case GEN.ATTACK: zone.attack = tc2sec(g.amt); break;
          case GEN.HOLD: zone.hold = tc2sec(g.amt); break;
          case GEN.DECAY: zone.decay = tc2sec(g.amt); break;
          case GEN.SUSTAIN: zone.sustain = Math.pow(10, -Math.max(0, Math.min(1440, g.amt)) / 200); break;
          case GEN.RELEASE: zone.release = tc2sec(g.amt); break;
          case GEN.ATTENUATION: zone.attenuation = g.amt; break;
          case GEN.COARSE_TUNE: zone.coarse = g.amt; break;
          case GEN.FINE_TUNE: zone.fine = g.amt; break;
        }
      }
      if (zone.sampleIdx < 0) { global = zone; continue; } // a global zone carries defaults
      zones.push(zone);
    }
    instruments.push({ name: instRecords[i].name, zones });
  }

  // phdr/pbag/pgen: presets -> instrument links (+ preset-level key filter & tuning adds).
  const presets = new Map(); // bank*128+program -> zones[]
  const phdrRecords = [];
  for (let o = chunks.phdr.offset; o + 38 <= chunks.phdr.offset + chunks.phdr.size; o += 38) {
    phdrRecords.push({
      name: readName(bytes, o),
      program: view.getUint16(o + 20, true),
      bank: view.getUint16(o + 22, true),
      bagIdx: view.getUint16(o + 24, true),
    });
  }
  for (let i = 0; i < phdrRecords.length - 1; i++) {
    const rec = phdrRecords[i];
    const flat = [];
    for (let b = rec.bagIdx; b < phdrRecords[i + 1].bagIdx; b++) {
      const gens = pgen.slice(pbag[b], pbag[b + 1] ?? pgen.length);
      let keyLo = 0, keyHi = 127, velLo = 0, velHi = 127, coarse = 0, fine = 0, atten = 0, instIdx = -1;
      for (const g of gens) {
        if (g.op === GEN.KEY_RANGE) { keyLo = g.raw & 0xff; keyHi = (g.raw >> 8) & 0xff; }
        else if (g.op === GEN.VEL_RANGE) { velLo = g.raw & 0xff; velHi = (g.raw >> 8) & 0xff; }
        else if (g.op === GEN.COARSE_TUNE) coarse = g.amt;
        else if (g.op === GEN.FINE_TUNE) fine = g.amt;
        else if (g.op === GEN.ATTENUATION) atten = g.amt;
        else if (g.op === GEN.INSTRUMENT) instIdx = g.raw;
      }
      if (instIdx < 0 || !instruments[instIdx]) continue; // global preset zone: rare adds, skipped
      for (const z of instruments[instIdx].zones) {
        // Intersect ranges; add preset-level tuning/attenuation.
        const kLo = Math.max(keyLo, z.keyLo), kHi = Math.min(keyHi, z.keyHi);
        const vLo = Math.max(velLo, z.velLo), vHi = Math.min(velHi, z.velHi);
        if (kLo > kHi || vLo > vHi) continue;
        flat.push({ ...z, keyLo: kLo, keyHi: kHi, velLo: vLo, velHi: vHi, coarse: z.coarse + coarse, fine: z.fine + fine, attenuation: z.attenuation + atten });
      }
    }
    if (flat.length) presets.set(rec.bank * 128 + rec.program, { name: rec.name, zones: flat });
  }

  return { name, samples, sampleData, presets };
}
