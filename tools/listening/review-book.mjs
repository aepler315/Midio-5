#!/usr/bin/env node
// Bind the world-evaluation corpus to the production runs in a directory,
// freeze its split, and write the baseline review book (ReviewBook.js).
//
//   node tools/listening/review-book.mjs --runs <dir-of-case-dirs> --out <evidence-dir> \
//     [--corpus test/fixtures/world-evaluation.json] [--bindings-out docs/listening/corpus/bindings.json] \
//     [--split-out docs/listening/corpus/split-manifest.json]
//
// <evidence-dir> receives book.json (ratings empty, for a human), book.md (a
// table of exploratory run digests), charts/<case>.svg and the split
// manifest. Bindings hold hashes, durations and run identities only: no
// audio, no absolute paths.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindCorpus, freezeSplit, baselineReviewBook } from '../../src/eval/listening/ReviewBook.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArgs(argv) {
  const out = { corpus: path.join(ROOT, 'test/fixtures/world-evaluation.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === '--runs') out.runs = next();
    else if (a === '--out') out.out = next();
    else if (a === '--corpus') out.corpus = next();
    else if (a === '--bindings-out') out.bindingsOut = next();
    else if (a === '--split-out') out.splitOut = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.runs || !out.out) throw new Error('--runs and --out are required');
  return out;
}

async function readRuns(dir) {
  const runs = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { runs.push(JSON.parse(await readFile(path.join(dir, entry.name, 'run.json'), 'utf8'))); } catch { /* not a case directory */ }
  }
  return runs;
}

const fmt = (v, d = 2) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v));

/** Mean of `values` over consecutive `binMs` windows (display only). */
function binned(tMs, values, binMs) {
  const out = { tMs: [], values: [] };
  let i = 0;
  while (i < tMs.length) {
    const start = tMs[i];
    let sum = 0, n = 0;
    while (i < tMs.length && tMs[i] < start + binMs) { if (values[i] != null) { sum += values[i]; n++; } i++; }
    out.tMs.push(start + binMs / 2);
    out.values.push(n ? sum / n : null);
  }
  return out;
}

/** A plain SVG of measured energy against the live heuristics. Exploratory:
 *  energy is drawn as 1 s means so beat-level ripple does not hide the
 *  heuristics, which are drawn as sampled (what playback showed). */
export function runChart(run, { width = 960, height = 300 } = {}) {
  const dur = run.recording.decoded.durationMs;
  const top = 46, bottom = height - 24;
  const x = (t) => (t / dur) * (width - 60) + 50;
  const y = (v, lo = 0, hi = 1) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const line = (ts, vs, lo, hi) => ts.map((t, i) => (vs[i] == null ? null : `${x(t).toFixed(1)},${y(vs[i], lo, hi).toFixed(1)}`)).filter(Boolean).join(' ');
  const h = run.heuristics, e = run.evidence.energy;
  const energy = binned(e.tMs, e.globalNorm, 1000);
  const series = [
    ['energy, 1 s mean (measured)', line(energy.tMs, energy.values, 0, 1), '#999', 2],
    ['calm', line(h.tMs, h.channels['calm.level'], 0, 1), '#3a7bd5', 1],
    ['epic', line(h.tMs, h.channels['vibe.epic'], 0, 1), '#d5533a', 1.2],
    ['valence (−1..1)', line(h.tMs, h.channels['vibe.valence'], -1, 1), '#3aa35b', 1.2],
    ['tonic confidence', line(h.tMs, h.channels['vibe.tonicConfidence'], 0, 1), '#9b59b6', 1],
  ];
  const minutes = [];
  for (let m = 0; m * 60000 <= dur; m++) minutes.push(`<text x="${x(m * 60000).toFixed(1)}" y="${height - 8}" font-size="10" text-anchor="middle">${m}:00</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="50" y="14" font-size="12">${run.caseId ?? run.recording.fileName} · ${run.recording.sha256.slice(0, 12)} · ${run.source.commit.slice(0, 7)} · exploratory, not an emotion measurement</text>
${series.map(([name, , c], i) => `<rect x="${50 + i * 175}" y="24" width="10" height="10" fill="${c}"/><text x="${64 + i * 175}" y="33" font-size="11">${name}</text>`).join('\n')}
<rect x="50" y="${top}" width="${width - 60}" height="${bottom - top}" fill="none" stroke="#ddd"/>
${series.map(([, pts, c, w]) => `<polyline fill="none" stroke="${c}" stroke-width="${w}" points="${pts}"/>`).join('\n')}
${minutes.join('\n')}
</svg>
`;
}

export function bookMarkdown(book, split) {
  const rows = book.cases.map((c) => {
    const d = c.digest || {};
    return `| ${c.id} | ${c.split} | ${c.status}${c.reason ? ` (${c.reason})` : ''} | ${c.recordingSha256 ? c.recordingSha256.slice(0, 12) : '—'} | ${fmt(d.durationMs != null ? d.durationMs / 1000 : null, 0)} | ${fmt(d.bpm, 0)} / ${fmt(d.tempoConfidence)} | ${fmt(d.globalKeyConfidence)} | ${fmt(d.meanEnergy)} | ${fmt(d.meanCalm)} | ${fmt(d.meanEpic)} | ${fmt(d.meanValence)} | ${fmt(d.drops, 0)} | ${fmt(d.inferredPitchShare)} |`;
  });
  const s = book.summary;
  return `# Production baseline review book

Exploratory machine digests next to empty human reviews. Heuristic values are
the live directors' own scales, not emotion intensities. Review fields
(${book.reviewFields.join(', ')}) are filled by a person in book.json.

Target (not a result): ${book.acceptance.note}

| Split | Cases | Synthetic | Unavailable | Bound recordings | Reviewed | Passing | Rate |
|---|---|---|---|---|---|---|---|
| tune | ${s.tune.cases} | ${s.tune.synthetic} | ${s.tune.unavailable} | ${s.tune.boundRecordings} | ${s.tune.reviewed} | ${s.tune.passing} | ${fmt(s.tune.rate)} |
| holdout | ${s.holdout.cases} | ${s.holdout.synthetic} | ${s.holdout.unavailable} | ${s.holdout.boundRecordings} | ${s.holdout.reviewed} | ${s.holdout.passing} | ${fmt(s.holdout.rate)} |

${s.note}

Split manifest frozen: ${split.frozen ? 'yes' : `no (${split.errors.join('; ')})`}.

| Case | Split | Status | Recording | Seconds | BPM / conf. | Key conf. | Energy | Calm | Epic | Valence | Drops | Inferred-pitch share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

export async function writeReviewBook(args) {
  const corpus = JSON.parse(await readFile(args.corpus, 'utf8'));
  const runs = await readRuns(args.runs);
  const bindings = bindCorpus(corpus, runs);
  const split = freezeSplit(bindings);
  split.revision = createHash('sha256').update(JSON.stringify({ groups: split.groups, recordings: split.recordings })).digest('hex');
  const book = baselineReviewBook(bindings, runs);
  book.splitRevision = split.revision;
  await mkdir(path.join(args.out, 'charts'), { recursive: true });
  await writeFile(path.join(args.out, 'book.json'), `${JSON.stringify(book, null, 2)}\n`);
  await writeFile(path.join(args.out, 'book.md'), bookMarkdown(book, split));
  await writeFile(path.join(args.out, 'split-manifest.json'), `${JSON.stringify(split, null, 2)}\n`);
  for (const run of runs) if (run.caseId) await writeFile(path.join(args.out, 'charts', `${run.caseId}.svg`), runChart(run));
  if (args.bindingsOut) { await mkdir(path.dirname(args.bindingsOut), { recursive: true }); await writeFile(args.bindingsOut, `${JSON.stringify(bindings, null, 2)}\n`); }
  if (args.splitOut) { await mkdir(path.dirname(args.splitOut), { recursive: true }); await writeFile(args.splitOut, `${JSON.stringify(split, null, 2)}\n`); }
  return { bindings, split, book, runs: runs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { bindings, split, book, runs } = await writeReviewBook(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ runs, bound: bindings.tracks.filter((t) => t.status === 'bound').map((t) => t.id),
      errors: bindings.errors, splitFrozen: split.frozen, splitRevision: split.revision, summary: book.summary }, null, 2)}\n`);
    if (bindings.errors.length || !split.frozen) process.exitCode = 2;
  } catch (err) {
    console.error(`review-book: ${err?.stack || err}`);
    process.exitCode = 1;
  }
}
