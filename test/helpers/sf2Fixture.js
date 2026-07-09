// Builds a tiny but structurally valid SoundFont 2 file in memory, for
// testing the parser without shipping a binary fixture. Layout:
//   INAM "TestFont"
//   smpl: 64-sample sine
//   Inst0: global zone (release 1200tc) + two key-split zones
//     zone A: keys 40..80, fine +5, no loop
//     zone B: keys 81..127, looped (modes 1)
//   Preset "Piano Test" (bank 0, prog 0): zone keys 60..100, fine +10 -> Inst0
//   Preset "Drums Test" (bank 128, prog 0): full-range zone -> Inst0
const GEN = {
  ATTACK: 34, RELEASE: 38, INSTRUMENT: 41, KEY_RANGE: 43,
  FINE_TUNE: 52, SAMPLE_ID: 53, SAMPLE_MODES: 54,
};

const enc = new TextEncoder();

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function chunk(id, body) {
  const head = new Uint8Array(8);
  head.set(enc.encode(id), 0);
  new DataView(head.buffer).setUint32(4, body.length, true);
  const pad = body.length & 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concat(head, body, pad);
}

function list(type, ...chunks) {
  return chunk('LIST', concat(enc.encode(type), ...chunks));
}

function str20(name) {
  const out = new Uint8Array(20);
  out.set(enc.encode(name).subarray(0, 19), 0);
  return out;
}

/** [['u16', v], ['u32', v], ['i8', v], ['i16', v], ['name20', s], ...] -> bytes */
function pack(fields) {
  const size = fields.reduce((n, [t]) => n + ({ u16: 2, i16: 2, u32: 4, u8: 1, i8: 1, name20: 20 }[t]), 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const [t, v] of fields) {
    if (t === 'u16') { view.setUint16(o, v, true); o += 2; }
    else if (t === 'i16') { view.setInt16(o, v, true); o += 2; }
    else if (t === 'u32') { view.setUint32(o, v, true); o += 4; }
    else if (t === 'u8') { view.setUint8(o, v); o += 1; }
    else if (t === 'i8') { view.setInt8(o, v); o += 1; }
    else if (t === 'name20') { out.set(str20(v), o); o += 20; }
  }
  return out;
}

const phdrRec = (name, program, bank, bagIdx) => pack([
  ['name20', name], ['u16', program], ['u16', bank], ['u16', bagIdx],
  ['u32', 0], ['u32', 0], ['u32', 0],
]);
const bagRec = (genIdx) => pack([['u16', genIdx], ['u16', 0]]);
const genRec = (op, amt) => pack([['u16', op], ['i16', amt]]);
const genRecRaw = (op, raw) => pack([['u16', op], ['u16', raw]]);
const instRec = (name, bagIdx) => pack([['name20', name], ['u16', bagIdx]]);
const shdrRec = (name, start, end, loopStart, loopEnd, rate, key, corr, type) => pack([
  ['name20', name], ['u32', start], ['u32', end], ['u32', loopStart], ['u32', loopEnd],
  ['u32', rate], ['u8', key], ['i8', corr], ['u16', 0], ['u16', type],
]);
const range = (lo, hi) => lo | (hi << 8);

export const FIXTURE_SAMPLE_COUNT = 64;

/** @returns {ArrayBuffer} a complete little sf2 file */
export function buildTestSf2() {
  const smpl = new Uint8Array(FIXTURE_SAMPLE_COUNT * 2);
  const smplView = new DataView(smpl.buffer);
  for (let i = 0; i < FIXTURE_SAMPLE_COUNT; i++) {
    smplView.setInt16(i * 2, Math.round(Math.sin((i / FIXTURE_SAMPLE_COUNT) * Math.PI * 8) * 12000), true);
  }

  const phdr = concat(
    phdrRec('Piano Test', 0, 0, 0),
    phdrRec('Drums Test', 0, 128, 1),
    phdrRec('EOP', 0, 0, 2),
  );
  const pbag = concat(bagRec(0), bagRec(3), bagRec(4));
  const pgen = concat(
    genRecRaw(GEN.KEY_RANGE, range(60, 100)), // Piano Test zone
    genRec(GEN.FINE_TUNE, 10),
    genRecRaw(GEN.INSTRUMENT, 0),
    genRecRaw(GEN.INSTRUMENT, 0),             // Drums Test zone (full range)
    genRec(0, 0),                             // terminal
  );
  const inst = concat(instRec('Inst0', 0), instRec('EOI', 3));
  const ibag = concat(bagRec(0), bagRec(1), bagRec(4), bagRec(7));
  const igen = concat(
    genRec(GEN.RELEASE, 1200),                 // bag 0: global zone (no sampleID)
    genRecRaw(GEN.KEY_RANGE, range(40, 80)),   // bag 1: zone A
    genRec(GEN.FINE_TUNE, 5),
    genRecRaw(GEN.SAMPLE_ID, 0),
    genRecRaw(GEN.KEY_RANGE, range(81, 127)),  // bag 2: zone B
    genRecRaw(GEN.SAMPLE_MODES, 1),
    genRecRaw(GEN.SAMPLE_ID, 0),
    genRec(0, 0),                              // terminal
  );
  const shdr = concat(
    shdrRec('Sine0', 0, FIXTURE_SAMPLE_COUNT, 8, 56, 22050, 60, -5, 1),
    shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0, 0),
  );

  const body = concat(
    enc.encode('sfbk'),
    list('INFO', chunk('INAM', enc.encode('TestFont\0\0'))),
    list('sdta', chunk('smpl', smpl)),
    list('pdta',
      chunk('phdr', phdr), chunk('pbag', pbag), chunk('pgen', pgen),
      chunk('inst', inst), chunk('ibag', ibag), chunk('igen', igen),
      chunk('shdr', shdr)),
  );
  const file = chunk('RIFF', body);
  // Copy into a fresh ArrayBuffer so byteOffset is 0, like file.arrayBuffer().
  return file.slice().buffer;
}
