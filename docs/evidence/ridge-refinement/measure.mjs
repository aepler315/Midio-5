// Read-only geometry comparison. No renderer, audio playback or source mutation.
// Run from the refinement checkout; pass the baseline checkout explicitly.
// node docs/evidence/ridge-refinement/measure.mjs --before ../terrain-implementation --after . --output docs/evidence/ridge-refinement/metrics.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, arg, i, all) => {
  if (i % 2 === 0) rows.push([arg.replace(/^--/, ''), all[i + 1]]); return rows;
}, []));
assert.ok(args.before && args.after && args.output, '--before, --after and --output are required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['src/world/RidgeMotionHistory.js', 'src/world/alpine/RidgeMotion.js', 'src/audio/EnergyCurves.js',
  'src/world/VisualMusicHistory.js', 'src/world/alpine/RangeNarrative.js', 'src/world/MountainChoreo.js',
  'src/world/terrain/HorizonRidge.js', 'src/utils/math.js'];
const viewport = { width: 1280, height: 720 };
const crest = { heights: new Float32Array([1, 1]), stepM: 1, windowM: 1, travelM: 0 };
const definitions = {
  geometry: 'sampleHorizonRidge production point-y geometry, matching x indices within 0..1280; no pixel raster',
  viewport, crest: { heights: [1, 1], stepM: 1, windowM: 1, travelM: 0 }, songP: .5,
  advection: 'ridgeAdvectionPxAt(heardTimeMs) from each tree', durationMs: 6000, sourceRateHz: 50,
  silence: { beforeMs: 999.999, afterMs: 1000, bands: Array(7).fill(.8), rmsBefore: .01, rmsAfter: 1e-6,
    rmsChangeAtSourceIndex: 50, optionalTrackedMelody: { tMs: 0, durMs: 2000, vel: 1, role: 'BASS', src: 'audio',
      pitch: 48, pitchConfidence: 1, pitchProvenance: 'tracked' } },
  kicks: { spacingMs: [250, 500], compare: 'spacing-.001 versus spacing', energyCurves: null,
    event: { durMs: 100, vel: 1, src: 'midi', role: 'RHYTHM', kick: true }, onsetTimes: '[0, spacing]' },
  steady: { bands: Array(7).fill(.5), rms: .01, timeline: [], startMs: 1500, endMs: 4500, fps: 60,
    definition: 'maximum absolute point-y change between 180 adjacent frames; spatial turns count strict changes in the sign of consecutive y differences at each sampled frame' },
};
const report = { classification: 'Synthetic flat-crest geometry comparison, not full-scene or artistic acceptance',
  units: 'logical pixels at 1280x720', definitions, results: {}, sources: {},
  limitations: ['No real terrain crest, camera travel, renderer raster, painting latency, visual perception or device timing is measured.',
    'The 0.001ms onset interval isolates discontinuities; it is not a real playback frame interval.',
    'Spatial turns describe a flat synthetic carrier, not complexity of a geographic skyline.'],
  reproduce: 'node docs/evidence/ridge-refinement/measure.mjs --before ../terrain-implementation --after . --output docs/evidence/ridge-refinement/metrics.json',
  runtime: { node: process.version }, reproducerSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) };
for (const [name, rootValue] of [['before', args.before], ['after', args.after]]) {
  const root = path.resolve(rootValue), sources = {};
  for (const file of files) sources[file] = hash(await fs.readFile(path.join(root, file)));
  report.sources[name] = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    changes: execFileSync('git', ['status', '--porcelain', '--', 'src/world/RidgeMotionHistory.js', 'src/world/alpine/RidgeMotion.js'],
      { cwd: root, encoding: 'utf8' }).trim(), files: sources };
  const load = file => import(pathToFileURL(path.join(root, file)).href);
  const [{ EnergyCurves }, { RidgeMotionHistory, ridgeAdvectionPxAt }, { sampleHorizonRidge }] = await Promise.all([
    load('src/audio/EnergyCurves.js'), load('src/world/RidgeMotionHistory.js'), load('src/world/alpine/RidgeMotion.js')]);
  const curves = (level, rms, silence = false) => {
    const value = new EnergyCurves(definitions.durationMs, definitions.sourceRateHz);
    value.bands.forEach(band => band.fill(level));
    value.rmsBands = value.bands.map(band => Float32Array.from(band, (_, i) => silence && i >= 50 ? 1e-6 : rms));
    return value;
  };
  const points = (history, heardTimeMs) => sampleHorizonRidge({ viewport, crest, songP: .5, history, heardTimeMs,
    advectionPx: ridgeAdvectionPxAt(heardTimeMs) }).points.filter(point => point.x >= 0 && point.x <= viewport.width);
  const delta = (a, b) => {
    assert.equal(a.length, b.length);
    let max = 0, x = 0;
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].x, b[i].x);
      if (Math.abs(a[i].y - b[i].y) > max) { max = Math.abs(a[i].y - b[i].y); x = a[i].x; }
    }
    return { maxAbsDeltaPx: max, atXPx: x, pointCount: a.length };
  };
  const sampleState = state => ({ activity01: state.activity01, motionPresence01: state.motionPresence01,
    motionMelody: state.motionMelody, rawMelodyActivity: state.sources.midio.activity, kick01: state.kick01 });
  const silence = [];
  for (const withTrackedMelody of [false, true]) {
    const history = new RidgeMotionHistory({ energyCurves: curves(.8, .01, true), durationMs: definitions.durationMs,
      timeline: withTrackedMelody ? [definitions.silence.optionalTrackedMelody] : [] });
    silence.push({ withTrackedMelody, ...delta(points(history, 999.999), points(history, 1000)),
      before: sampleState(history.sample(999.999)), after: sampleState(history.sample(1000)) });
  }
  const kicks = [];
  for (const spacingMs of definitions.kicks.spacingMs) {
    const history = new RidgeMotionHistory({ durationMs: definitions.durationMs,
      timeline: [0, spacingMs].map(tMs => ({ ...definitions.kicks.event, tMs })) });
    kicks.push({ spacingMs, ...delta(points(history, spacingMs - .001), points(history, spacingMs)),
      beforeKick01: history.sample(spacingMs - .001).kick01, atOnsetKick01: history.sample(spacingMs).kick01 });
  }
  const history = new RidgeMotionHistory({ energyCurves: curves(.5, .01), durationMs: definitions.durationMs });
  const turns = points => {
    let count = 0;
    for (let i = 1; i < points.length - 1; i++) if ((points[i].y - points[i - 1].y) * (points[i + 1].y - points[i].y) < 0) count++;
    return count;
  };
  let prior = points(history, 1500), worst = { maxAbsDeltaPx: 0 }, minTurns = turns(prior), maxTurns = minTurns;
  for (let frame = 1; frame <= 180; frame++) {
    const atMs = 1500 + frame * 1000 / 60, next = points(history, atMs), d = delta(prior, next), count = turns(next);
    if (d.maxAbsDeltaPx > worst.maxAbsDeltaPx) worst = { ...d, fromMs: atMs - 1000 / 60, toMs: atMs };
    minTurns = Math.min(minTurns, count); maxTurns = Math.max(maxTurns, count); prior = next;
  }
  report.results[name] = { silence, kicks, steady: { ...worst, minSpatialTurns: minTurns, maxSpatialTurns: maxTurns, adjacentFramePairs: 180 } };
  for (const file of files) assert.equal(hash(await fs.readFile(path.join(root, file))), sources[file], `${name} changed while evaluating ${file}`);
}
await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
await fs.writeFile(args.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.results, null, 2));
