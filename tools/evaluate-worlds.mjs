#!/usr/bin/env node
// Private world-quality evaluation. Heuristic scores are recorded but never
// used as a gallery ranking. Ratings stay empty until a human fills them.
//
// Usage:
//   npm run eval:worlds
//   npm run eval:worlds -- --split holdout
//   npm run eval:worlds -- path/to/corpus.json --split tune
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCorpus } from '../src/eval/WorldQuality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CORPUS = join(root, 'test/fixtures/world-evaluation.json');

function parseArgs(argv) {
  let corpusPath = DEFAULT_CORPUS;
  let split = 'all';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--split') split = argv[++i] || 'all';
    else if (a === '--help' || a === '-h') return { help: true };
    else if (!a.startsWith('-')) corpusPath = a;
  }
  if (!['all', 'tune', 'holdout'].includes(split)) {
    throw new Error(`--split must be all, tune, or holdout (got ${split})`);
  }
  return { corpusPath, split };
}

const HELP = `Usage: npm run eval:worlds -- [--split all|tune|holdout] [corpus.json]

Emits a JSON review book. Viewing order is authored, not ranked. Heuristic
scores are private. Ratings are empty until filled. This is not a beauty
score and does not claim the 80% holdout target.
`;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
  } else {
    const parsed = JSON.parse(await readFile(args.corpusPath, 'utf8'));
    const report = evaluateCorpus(parsed, { split: args.split });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.validation.ok) {
      process.stderr.write(`Corpus warnings:\n${report.validation.errors.map((e) => `  - ${e}`).join('\n')}\n`);
      process.exitCode = 2;
    }
  }
} catch (err) {
  console.error(`Could not evaluate world corpus: ${err?.message || err}`);
  process.exitCode = 1;
}
