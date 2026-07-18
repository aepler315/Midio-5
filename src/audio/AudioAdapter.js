// Adapter: decoded AudioBuffer -> unified NoteEvent[] timeline + bar grid +
// continuous EnergyCurves (spec §1.2). Produces the exact same shapes the
// MIDI adapter does, so the two inputs are indistinguishable downstream.
//
// The parity pass: melody/bass events carry REAL pitches (FFT peak
// tracking + bass autocorrelation, see PitchTracker.js) and real sustain
// lengths, and sustained harmony is emitted as per-bar PAD chord events --
// so every pitch consumer (Midasus's vertical dance, Broshi's hop heights,
// VibeDirector's valence/tonic, KeyDirector's key changes, the biome
// fingerprint's dominant-class hue) behaves the same as it does on MIDI.
// The adapter also returns an `analysis` fingerprint (chroma, tonality,
// brightness, dynamic range, stereo width) for the custom-biome importer.
import { separateStems } from './StemSeparator.js';
import {
  computeBandEnvelopes, normalizeBands, detectRhythmOnsets, estimateTempo,
  extractPseudoLane, mixBandEnvelopes, estimateSustainMs,
} from './OnsetDetector.js';
import {
  computePitchFeatures, chromaHistogram, melodyPitchAt, estimateBassPitchAt,
  tonalityFrom, meanBrightness, windowChroma,
} from './PitchTracker.js';
import { EnergyCurves } from './EnergyCurves.js';
import { Role, makeNoteEvent, sortNoteEvents } from '../core/NoteEvent.js';
import { clamp01 } from '../utils/math.js';

/** Mono mixdown of an AudioBuffer's channels into one Float32Array. */
function mixToMono(audioBuffer) {
  const n = audioBuffer.length;
  const chans = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c));
  if (chans.length === 1) return chans[0];
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const ch of chans) s += ch[i];
    mono[i] = s / chans.length;
  }
  return mono;
}

/** Stereo width 0..1 from L/R decorrelation (0 = mono, 1 = fully decorrelated). */
function stereoWidth(audioBuffer) {
  if (audioBuffer.numberOfChannels < 2) return 0;
  const L = audioBuffer.getChannelData(0), R = audioBuffer.getChannelData(1);
  const stride = Math.max(1, Math.floor(audioBuffer.length / 200000)); // cap the work on long files
  let sLR = 0, sLL = 0, sRR = 0;
  for (let i = 0; i < audioBuffer.length; i += stride) {
    sLR += L[i] * R[i]; sLL += L[i] * L[i]; sRR += R[i] * R[i];
  }
  const denom = Math.sqrt(sLL * sRR);
  if (denom < 1e-9) return 0;
  return clamp01(1 - sLR / denom);
}

/** Dynamic range 0..1 from loudness-envelope percentiles: how far the
 *  quiet passages sit below the loud ones (compressed wall-of-sound -> 0). */
function dynamicRange(rawBands) {
  const n = rawBands[0].length;
  const loud = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const b of rawBands) s += b[i];
    loud[i] = s;
  }
  const sorted = Array.from(loud).sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const hi = p(0.90);
  if (hi < 1e-9) return 0;
  return clamp01(1 - p(0.25) / hi);
}

export async function audioToTimeline(audioBuffer, { onProgress = null } = {}) {
  const stems = await separateStems(audioBuffer, (p) => onProgress?.({ phase: 'separate', progress: p }));
  onProgress?.({ phase: 'analyze', progress: 0 });

  const { rate, raw } = computeBandEnvelopes(stems);
  const normBands = normalizeBands(raw, rate);

  const { O, onsets: rhythmOnsets } = detectRhythmOnsets(normBands, raw, rate, 1);
  const kickFrames = rhythmOnsets.filter((o) => o.kick).map((o) => o.frame);
  const tempo = estimateTempo(O, rate, kickFrames);

  // Real pitch analysis on the actual samples: FFT peak tracking over the
  // full mix for melody/harmony, autocorrelation over the bass stems (FFT
  // bins are far too coarse below ~100 Hz to separate semitones).
  onProgress?.({ phase: 'pitch', progress: 0 });
  const mono = mixToMono(audioBuffer);
  const pitchFeatures = computePitchFeatures(mono, audioBuffer.sampleRate);
  const bassMono = mixToMono(stems[1]); // the BASS band stem: 60-250 Hz, already isolated

  const melodyLane = extractPseudoLane(normBands, rate, {
    bandIndices: [2, 3, 4], pitchLo: 60, pitchHi: 96, role: Role.MELODY, onsetThreshold: 1,
  });
  const bassLane = extractPseudoLane(normBands, rate, {
    bandIndices: [0, 1], pitchLo: 28, pitchHi: 52, role: Role.BASS, onsetThreshold: 1,
  });
  const melodyMix = mixBandEnvelopes(normBands, [2, 3, 4]);
  const bassMix = mixBandEnvelopes(normBands, [0, 1]);

  const timeline = [];
  for (const o of rhythmOnsets) {
    timeline.push(makeNoteEvent({
      tMs: o.tMs, durMs: 90, pitch: o.pitch, vel: o.vel, role: Role.RHYTHM, kick: o.kick, src: 'audio', channel: 0,
    }));
  }
  for (const n of melodyLane) {
    const tracked = melodyPitchAt(pitchFeatures, n.tMs);
    timeline.push(makeNoteEvent({
      tMs: n.tMs, durMs: estimateSustainMs(melodyMix, rate, n.frame), pitch: tracked ?? n.pitch,
      vel: n.vel, role: Role.MELODY, src: 'audio', channel: 3,
    }));
  }
  for (const n of bassLane) {
    const tracked = estimateBassPitchAt(bassMono, audioBuffer.sampleRate, n.tMs);
    timeline.push(makeNoteEvent({
      tMs: n.tMs, durMs: estimateSustainMs(bassMix, rate, n.frame), pitch: tracked ?? n.pitch,
      vel: n.vel, role: Role.BASS, src: 'audio', channel: 1,
    }));
  }

  const durationMs = (raw[0].length / rate) * 1000;

  // tempo.firstBarMs is already the first downbeat at/after t=0 (spec §1.2.5).
  const barGrid = [];
  if (!tempo.freeTime) {
    let bar = 0;
    for (let t = tempo.firstBarMs; t < durationMs; t += tempo.barPeriodMs, bar++) {
      barGrid.push({ tick: bar * 4, ms: t, numerator: 4, denominator: 4 });
    }
  }

  // PAD chords: each bar's sustained harmonic content collapsed to its
  // strongest pitch classes and emitted as long chord tones -- the same
  // material a MIDI pad track would carry. Feeds VibeDirector's tonality
  // window, the composer strip, and the fingerprint's role mix. Free-time
  // audio chords on a fixed 2s pseudo-bar instead.
  const chordWindows = [];
  if (barGrid.length > 0) {
    for (let i = 0; i < barGrid.length; i++) {
      chordWindows.push([barGrid[i].ms, i + 1 < barGrid.length ? barGrid[i + 1].ms : durationMs]);
    }
  } else {
    for (let t = 0; t < durationMs; t += 2000) chordWindows.push([t, Math.min(durationMs, t + 2000)]);
  }
  const midMix = mixBandEnvelopes(normBands, [2, 3]);
  for (const [fromMs, toMs] of chordWindows) {
    const chord = windowChroma(pitchFeatures, fromMs, toMs, 3);
    if (chord.length < 2) continue; // a lone class is a melody note's residue, not harmony
    const frame = Math.min(midMix.length - 1, Math.round((fromMs / 1000) * rate));
    const vel = clamp01(0.25 + 0.5 * midMix[frame]);
    for (const c of chord) {
      timeline.push(makeNoteEvent({
        tMs: fromMs, durMs: Math.max(300, (toMs - fromMs) * 0.9), pitch: 60 + c.pc,
        vel: vel * (0.6 + 0.4 * c.strength), role: Role.PAD, src: 'audio', channel: 2,
      }));
    }
  }
  sortNoteEvents(timeline);

  const energyCurves = new EnergyCurves(durationMs, rate);
  for (let i = 0; i < energyCurves.n; i++) {
    const frame = Math.min(raw[0].length - 1, i);
    energyCurves.setFrame(i, normBands.map((b) => b[frame] ?? 0));
  }

  // The song's analysis fingerprint: whole-song tonality + texture stats
  // the custom-biome importer turns into this file's unique world.
  const chroma = chromaHistogram(pitchFeatures);
  const tonality = tonalityFrom(chroma);
  const analysis = {
    chroma,
    tonic: tonality.tonic,
    mode: tonality.mode,
    majorness: tonality.majorness,
    tonalConfidence: tonality.confidence,
    brightness: meanBrightness(pitchFeatures),
    dynamicRange: dynamicRange(raw),
    stereoWidth: stereoWidth(audioBuffer),
  };

  onProgress?.({ phase: 'done', progress: 1 });

  return {
    timeline, barGrid, durationMs,
    bpm: tempo.bpm, beatPeriodMs: tempo.beatPeriodMs, confidence: tempo.confidence, freeTime: tempo.freeTime,
    energyCurves, analysis,
  };
}
