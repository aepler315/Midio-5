// Builds a minimal valid SF2 (SoundFont 2) file in memory for unit tests.
// Contains 1 preset (bank 0, program 0), 1 instrument, 1 sample (sine wave),
// with keyRange/velRange/envelope generators in the instrument zone.

const SAMPLE_COUNT = 97; // 194 bytes of int16 PCM
const SAMPLE_RATE = 44100;

// Byte-builder helpers
function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]; }
function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function i16(v) { return u16(v < 0 ? v + 0x10000 : v); }
function i8v(v) { return [v & 0xff]; }
function fourcc(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }
function str(s, len) {
  const a = [];
  for (let i = 0; i < len; i++) a.push(i < s.length ? s.charCodeAt(i) : 0);
  return a;
}
function padEven(arr) { if (arr.length & 1) arr.push(0); return arr; }
function cat(...arrs) { return arrs.flat(); }

export function buildMinimalSf2(name = 'TestFont') {
  // --- Sample data: sine wave ---
  const smplData = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const v = Math.round(Math.sin((i / SAMPLE_COUNT) * Math.PI * 2) * 0.8 * 32767);
    smplData.push(...i16(v));
  }
  const smplChunk = cat(fourcc('smpl'), u32(smplData.length), smplData);

  // --- INFO/INAM ---
  const inamData = str(name, name.length + 1); // null-terminated
  const inamChunk = padEven(cat(fourcc('INAM'), u32(inamData.length), inamData).slice());
  // Actually padEven mutates in place, let me be explicit:
  const inamRaw = cat(fourcc('INAM'), u32(inamData.length), inamData);
  if (inamRaw.length & 1) inamRaw.push(0);
  const infoBody = cat(fourcc('INFO'), inamRaw);
  const infoList = cat(fourcc('LIST'), u32(infoBody.length), infoBody);

  // --- sdta LIST ---
  const sdtaBody = cat(fourcc('sdta'), smplChunk);
  const sdtaList = cat(fourcc('LIST'), u32(sdtaBody.length), sdtaBody);

  // --- pdta sub-chunks ---

  // phdr: 1 real preset + 1 sentinel = 2 entries × 38 bytes
  const phdrData = cat(
    str('TestPreset', 20), u16(0), u16(0), u16(0), u32(0), u32(0), u32(0), // bank0/prog0, bag 0
    str('EOP', 20), u16(0), u16(0), u16(1), u32(0), u32(0), u32(0),          // sentinel, bag end=1
  );
  const phdrChunk = cat(fourcc('phdr'), u32(phdrData.length), phdrData);

  // pbag: 1 entry (genNdx=0, modNdx=0)
  const pbagData = cat(u16(0), u16(0));
  const pbagChunk = cat(fourcc('pbag'), u32(pbagData.length), pbagData);

  // pmod: 1 terminal entry (10 zeros)
  const pmodData = new Array(10).fill(0);
  const pmodChunk = cat(fourcc('pmod'), u32(pmodData.length), pmodData);

  // pgen: 1 entry (instrument=0)
  const pgenData = cat(u16(41), u16(0));
  const pgenChunk = cat(fourcc('pgen'), u32(pgenData.length), pgenData);

  // inst: 1 real + 1 sentinel = 2 entries × 22 bytes
  const instData = cat(
    str('TestInst', 20), u16(0), // instrument 0, bag 0
    str('EOI', 20), u16(1),     // sentinel, bag end=1
  );
  const instChunk = cat(fourcc('inst'), u32(instData.length), instData);

  // ibag: 1 entry (genNdx=0, modNdx=0)
  const ibagData = cat(u16(0), u16(0));
  const ibagChunk = cat(fourcc('ibag'), u32(ibagData.length), ibagData);

  // imod: 1 terminal entry
  const imodData = new Array(10).fill(0);
  const imodChunk = cat(fourcc('imod'), u32(imodData.length), imodData);

  // igen: 6 entries — keyRange, velRange, attack, decay, sustain, sampleID
  const igenData = cat(
    u16(43), u16(40 | (84 << 8)),  // keyRange: 40-84
    u16(44), u16(20 | (110 << 8)),  // velRange: 20-110
    u16(36), i16(-6000),            // attackVol: -6000 timecents (~31ms)
    u16(33), i16(-4800),            // decayVol: -4800 timecents (~63ms)
    u16(34), i16(-100),             // sustainVol: -100 centibels (~31.6%)
    u16(53), u16(0),                // sampleID: 0 (terminal)
  );
  const igenChunk = cat(fourcc('igen'), u32(igenData.length), igenData);

  // shdr: 1 real + 1 sentinel = 2 entries × 46 bytes
  const shdrData = cat(
    str('TestSample', 20),
    u32(0), u32(SAMPLE_COUNT),           // start, end
    u32(16), u32(SAMPLE_COUNT - 16),     // loopStart, loopEnd
    u32(SAMPLE_RATE),                    // sampleRate
    i8v(60), i8v(0),                    // rootKey=60, fineTune=0 (int8)
    u16(0), u16(0),                      // link, type
    // sentinel
    str('EOS', 20),
    u32(0), u32(0), u32(0), u32(0),
    u32(44100),
    i8v(0), i8v(0), u16(0), u16(0),
  );
  const shdrChunk = cat(fourcc('shdr'), u32(shdrData.length), shdrData);

  // --- pdta LIST ---
  const pdtaBody = cat(fourcc('pdta'), phdrChunk, pbagChunk, pmodChunk, pgenChunk, instChunk, ibagChunk, imodChunk, igenChunk, shdrChunk);
  const pdtaList = cat(fourcc('LIST'), u32(pdtaBody.length), pdtaBody);

  // --- RIFF ---
  const riffBody = cat(fourcc('sfbk'), infoList, sdtaList, pdtaList);
  const riff = cat(fourcc('RIFF'), u32(riffBody.length), riffBody);

  const buf = new ArrayBuffer(riff.length);
  new Uint8Array(buf).set(riff);
  return buf;
}

export function buildBadSf2() {
  // Not a valid SF2 — wrong magic
  const bytes = [0x00, 0x01, 0x02, 0x03];
  return new Uint8Array(bytes).buffer;
}