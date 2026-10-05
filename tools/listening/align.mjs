#!/usr/bin/env node
// Validate a listening annotation against the recording it describes and,
// with a production run, write the alignment report.
//
//   node tools/listening/align.mjs --annotation song.yaml [--audio song.flac] \
//     [--run case/run.json] [--manifest case.json] [--purpose workflow|scored] [--out case/]
//
// Without --run it only parses and validates. The case manifest is built
// from what is supplied: --audio gives the submitted file's hash, --run the
// analysed recording's hash and duration, the annotation text its content
// hash; --manifest adds caseId, group, split and revision. Writes
// alignment.json and alignment.md (the listener's words beside the
// evidence). Exit 2 when the annotation or case is refused.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnnotation, AnnotationError } from '../../src/eval/listening/parseAnnotation.js';
import { validateCase } from '../../src/eval/listening/validateCase.js';
import { alignRun } from '../../src/eval/listening/alignRun.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseArgs(argv) {
  const out = { purpose: 'workflow' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === '--annotation') out.annotation = next();
    else if (a === '--audio') out.audio = next();
    else if (a === '--run') out.run = next();
    else if (a === '--manifest') out.manifest = next();
    else if (a === '--purpose') out.purpose = next();
    else if (a === '--out') out.out = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.annotation) throw new Error('--annotation is required');
  if (!['workflow', 'scored'].includes(out.purpose)) throw new Error('--purpose must be workflow or scored');
  return out;
}

const f = (v, d = 2) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v));

export function alignmentMarkdown(report) {
  const lines = [
    `# Listening alignment · ${report.caseId ?? 'case'}`,
    '',
    `Run ${report.run.runId?.slice(0, 12)} at ${report.run.commit.slice(0, 7)} · recording ${report.run.recordingSha256.slice(0, 12)} · semantic prediction: **${report.run.semantic}**`,
    `Binding to the case manifest: ${report.binding.checked ? 'checked' : 'unchecked'}.`,
    '',
    `> ${report.annotation.summary}`,
    '',
    `— ${report.annotation.listener ?? 'listener'} (${report.annotation.status}; ${report.annotation.perspective}; basis ${report.annotation.basis})`,
    '',
    `Annotated ${f(report.coverage.annotatedMs / 1000, 1)} s of ${f(report.coverage.recordingMs / 1000, 1)} s; analysed to ${f(report.coverage.analyzedToMs / 1000, 1)} s.`,
    report.coverage.uncovered.length ? `Uncovered: ${report.coverage.uncovered.map((u) => `segment ${u.segment} (${u.reason})`).join('; ')}.` : 'Every placed segment is inside the analysed interval.',
    '',
  ];
  for (const s of report.segments) {
    lines.push(`## ${s.span.join('–')}${s.label ? ` · ${s.label}` : ''} (${s.confidence})`, '');
    if (s.notes) lines.push(`Listener's notes: “${s.notes}”`, '');
    const emo = Object.entries(s.human.emotions || {}).map(([k, e]) => `${k} ${e.intensity ?? '?'}/4 ${e.role}`).join(', ');
    const snd = Object.entries(s.human.sound || {}).map(([k, v]) => `${k} ${v ?? '?'}`).join(', ');
    lines.push(`Heard: ${[snd && `sound ${snd}`, emo && `emotions ${emo}`].filter(Boolean).join('; ') || 'no ratings'}`, '');
    if (s.evidence) {
      const h = s.heuristics;
      lines.push('| Measured / heuristic | Value | Scale |', '|---|---|---|',
        `| energy (mean, min–max) | ${f(s.evidence.energy.mean)} (${f(s.evidence.energy.min)}–${f(s.evidence.energy.max)}) | ${s.evidence.energy.scale} |`,
        `| brightness | ${f(s.evidence.brightness.mean)} | ${s.evidence.brightness.scale} |`,
        `| onsets / s (all, rhythm) | ${f(s.evidence.onsetsPerSec.all, 1)}, ${f(s.evidence.onsetsPerSec.rhythm, 1)} | detected |`,
        `| key confidence | ${f(s.evidence.tonality.meanConfidence)} | 0..1 |`,
        ...['calm.level', 'hype.fast', 'vibe.valence', 'vibe.epic', 'vibe.tonicConfidence'].filter((k) => h[k])
          .map((k) => `| ${k} (heuristic) | ${f(h[k].mean)} | ${h[k].scale} |`), '');
    }
    const unsup = Object.entries(s.predictions || {}).filter(([, p]) => p.status === 'unsupported').map(([k]) => k);
    if (unsup.length) lines.push(`No prediction for: ${unsup.join(', ')}.`, '');
  }
  if (report.trends.length) {
    lines.push('## Trends', '');
    for (const t of report.trends) {
      lines.push(`- ${t.span.join('–')} ${t.target} ${t.direction} (${t.confidence}): prediction ${t.prediction.status}${t.prediction.status === 'scored' ? ` (Δ ${f(t.prediction.delta)}, ${t.prediction.agrees ? 'agrees' : 'differs'})` : ''}${t.evidenceDelta ? `; ${t.evidenceDelta.proxy} Δ ${f(t.evidenceDelta.delta)} (no verdict)` : ''}`);
    }
    lines.push('');
  }
  if (report.events.reference.length) {
    lines.push('## Foreground changes', '');
    for (const e of report.events.reference) lines.push(`- ${e.from} → ${e.to} within ${e.within.join('–')} (${e.confidence}; width ${f(e.widthMs / 1000, 1)} s)`);
    lines.push('', `Matching: ${report.events.matching.status ?? `precision ${f(report.events.matching.precision)}, recall ${f(report.events.matching.recall)} within ${report.events.matching.toleranceMs} ms`}.`, '');
  }
  lines.push(`Unsupported targets: ${report.unsupportedTargets.join(', ') || 'none'}.`, '', ...report.notes.map((n) => `_${n}_`), '');
  return lines.join('\n');
}

export async function runAlign(args) {
  const text = await readFile(args.annotation, 'utf8');
  const annotation = parseAnnotation(text);
  const run = args.run ? JSON.parse(await readFile(args.run, 'utf8')) : null;
  const extra = args.manifest ? JSON.parse(await readFile(args.manifest, 'utf8')) : {};
  const manifest = {
    purpose: args.purpose,
    annotationSha256: sha256(text),
    annotationRevision: extra.annotationRevision ?? null,
    annotator: annotation.listener,
    submittedAudioSha256: args.audio ? sha256(await readFile(args.audio)) : null,
    recording: run ? { sha256: run.recording.sha256, decodedDurationMs: run.recording.decoded.durationMs, fileName: run.recording.fileName } : extra.recording ?? null,
    ...extra,
  };
  const check = validateCase(annotation, manifest);
  let report = null;
  if (run && check.valid) {
    report = alignRun(annotation, run, { manifest });
    if (args.out) {
      await mkdir(args.out, { recursive: true });
      await writeFile(path.join(args.out, 'alignment.json'), `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(path.join(args.out, 'alignment.md'), alignmentMarkdown(report));
    }
  }
  return { annotation, manifest, check, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { check, report } = await runAlign(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ case: check, aligned: !!report, unsupportedTargets: report?.unsupportedTargets ?? null,
      coverage: report?.coverage ?? null }, null, 2)}\n`);
    if (!check.valid) process.exitCode = 2;
  } catch (err) {
    if (err instanceof AnnotationError) { console.error(err.message); process.exitCode = 2; }
    else { console.error(`align: ${err?.stack || err}`); process.exitCode = 1; }
  }
}
