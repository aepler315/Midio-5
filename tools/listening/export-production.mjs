#!/usr/bin/env node
// Export one production run (src/eval/listening/ProductionRun.js): a local
// recording analysed whole by Midio's own browser analyzer, its live
// heuristics stepped sequentially through the song, written as run.json.
//
//   node tools/listening/export-production.mjs --audio <local-file> --out <case-directory> \
//     [--step-ms 16.6666666667] [--sample-ms 100] [--case-id <corpus track id>] [--world <id>]
//
// The recording is served to a local headless Chromium from memory; it is
// never copied into the repository or the static bundle, and its absolute
// path is not written to the run. Cache reuse is off (a fresh analysis every
// time) and the human annotation, if any, is not read. No network access,
// model download or upload is involved.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { validateRun, serializeRun, DEFAULT_STEP_MS, DEFAULT_SAMPLE_MS } from '../../src/eval/listening/ProductionRun.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
const PAGE = '/__midio_production/page.html';
const AUDIO = '/__midio_production/audio';

const HELP = `Usage: node tools/listening/export-production.mjs --audio <file> --out <case-dir>
  [--step-ms ${DEFAULT_STEP_MS}] [--sample-ms ${DEFAULT_SAMPLE_MS}] [--case-id <id>] [--world <id>]

Writes <case-dir>/run.json and prints a short summary. Exits 2 if the run
fails its own bookkeeping checks (coverage, identity, provenance).`;

export function parseArgs(argv) {
  const out = { stepMs: DEFAULT_STEP_MS, sampleMs: DEFAULT_SAMPLE_MS, caseId: null, world: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === '--audio') out.audio = next();
    else if (a === '--out') out.out = next();
    else if (a === '--step-ms') out.stepMs = Number(next());
    else if (a === '--sample-ms') out.sampleMs = Number(next());
    else if (a === '--case-id') out.caseId = next();
    else if (a === '--world') out.world = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.help) return out;
  if (!out.audio || !out.out) throw new Error('--audio and --out are required');
  if (!(out.stepMs > 0) || !(out.sampleMs > 0)) throw new Error('--step-ms and --sample-ms must be positive numbers');
  if (out.sampleMs < out.stepMs) throw new Error('--sample-ms must be at least --step-ms');
  return out;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
}

/** Static, read-only, loopback server for the repository plus the recording
 *  from memory. Records the hash of every file the page actually loaded. */
async function serve(audioBytes) {
  const served = new Map();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      if (url.pathname === PAGE) {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>production run</title>');
        return;
      }
      if (url.pathname === AUDIO) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(audioBytes);
        return;
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !/^(src|node_modules)\//.test(rel)) { res.writeHead(404).end(); return; }
      const bytes = await readFile(file);
      served.set(rel, sha256(bytes));
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, served, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Runs inside the page: decode, analyse whole, build the evidence, step the
 *  heuristics. Everything it imports is the production module. */
async function pageRun({ stepMs, sampleMs, world }) {
  const [{ audioToTimeline }, { Conductor }, { ParamBus }, { Simulation }, run, worlds] = await Promise.all([
    import('/src/audio/AudioAdapter.js'), import('/src/core/Conductor.js'), import('/src/core/ParamBus.js'),
    import('/src/sim/Simulation.js'), import('/src/eval/listening/ProductionRun.js'), import('/src/world/Worlds.js'),
  ]);
  const bytes = await (await fetch('/__midio_production/audio')).arrayBuffer();
  // As AudioEngine.decodeFile: the page's AudioContext at its own rate.
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(bytes);
  const decoded = { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, frames: buffer.length, durationMs: buffer.duration * 1000 };
  const t0 = performance.now();
  // The whole recording, fresh: no opening slice, no cache, no learned groove.
  const data = await audioToTimeline(buffer, { groove: null, diagnostics: true });
  const analysisMs = performance.now() - t0;

  const worldId = world || worlds.DEFAULT_WORLD_ID;
  const conductor = new Conductor();
  conductor.load(data);
  // As startTimeline builds it, minus the presentation-only parts: zero
  // output latency (heard time = source time) and no visual lead.
  const sim = new Simulation(conductor, new ParamBus(), {
    bpm: data.bpm || 120, energyCurves: data.energyCurves || null, structure: data.structure || null,
    tonalityTimeline: data.tonalityTimeline || null, worldId, outputLatencyMs: () => 0, visualLeadMs: 0,
  });
  let last = performance.now();
  const maybeYield = async () => {
    if (performance.now() - last < 50) return;
    await new Promise((r) => setTimeout(r, 0));
    last = performance.now();
  };
  const t1 = performance.now();
  const heuristics = await run.sampleHeuristics(sim, { durationMs: decoded.durationMs, stepMs, sampleEveryMs: sampleMs, maybeYield });
  const stepMsElapsed = performance.now() - t1;
  sim.dispose();
  return {
    decoded, worldId, analysisMs, sampleMs: stepMsElapsed,
    coverage: run.measureCoverage(data, decoded.durationMs, heuristics),
    evidence: run.acousticEvidence(data, { sampleEveryMs: sampleMs }),
    heuristics,
  };
}

export async function exportProduction(args) {
  const audioPath = path.resolve(args.audio);
  const audioBytes = await readFile(audioPath);
  const audioSha = sha256(audioBytes);
  const { size } = await stat(audioPath);
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = (git(['status', '--porcelain', '--', 'src']) || '').length > 0;
  const config = {
    analyzer: 'AudioAdapter.audioToTimeline', options: { groove: null, diagnostics: true, openingSlice: false, cache: 'disabled' },
    stepMs: args.stepMs, sampleEveryMs: args.sampleMs, outputLatencyMs: 0, visualLeadMs: 0, world: args.world || 'default',
  };
  config.hash = sha256(JSON.stringify(config));

  const { server, served, origin } = await serve(audioBytes);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
    await page.goto(origin + PAGE);
    const result = await page.evaluate(pageRun, { stepMs: args.stepMs, sampleMs: args.sampleMs, world: args.world });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const { buildRun } = await import('../../src/eval/listening/ProductionRun.js');
    const servedModules = Object.fromEntries([...served.entries()].sort(([a], [b]) => a.localeCompare(b)));
    let run = buildRun({
      createdAt: new Date().toISOString(),
      caseId: args.caseId,
      recording: { sha256: audioSha, fileName: path.basename(audioPath), byteLength: size, decoded: result.decoded },
      coverage: result.coverage,
      source: { commit, dirtySrc: dirty, servedModules, servedModulesHash: sha256(JSON.stringify(servedModules)) },
      config: { ...config, world: result.worldId },
      environment: { browser: `chromium ${browser.version()}`, userAgent, node: process.version, platform: process.platform,
        timingsMs: { analysis: Math.round(result.analysisMs), heuristics: Math.round(result.sampleMs) }, pageErrors },
      evidence: result.evidence,
      heuristics: result.heuristics,
    });
    const body = serializeRun(run);
    run = { ...run, runId: sha256(body) };
    const text = serializeRun(run);
    const check = validateRun(JSON.parse(text), { audioSha256: audioSha, expectedCommit: commit });
    await mkdir(args.out, { recursive: true });
    await writeFile(path.join(args.out, 'run.json'), text);
    return { run, check, outFile: path.join(args.out, 'run.json'), bytes: text.length };
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) process.stdout.write(`${HELP}\n`);
    else {
      const { run, check, outFile, bytes } = await exportProduction(args);
      const h = run.heuristics;
      process.stdout.write(`${JSON.stringify({
        outFile, bytes, runId: run.runId, sha256: run.recording.sha256, commit: run.source.commit, dirtySrc: run.source.dirtySrc,
        decodedMs: Math.round(run.recording.decoded.durationMs), analyzedToMs: run.coverage.analyzedToMs,
        samples: h.tMs.length, steps: h.steps, timingsMs: run.environment.timingsMs, pageErrors: run.environment.pageErrors.length,
        valid: check.valid, errors: check.errors,
      }, null, 2)}\n`);
      if (!check.valid) process.exitCode = 2;
    }
  } catch (err) {
    console.error(`export-production: ${err?.stack || err}`);
    process.exitCode = 1;
  }
}
