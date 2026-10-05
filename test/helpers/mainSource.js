// Source text of individual top-level functions in src/main.js, so tests can
// execute the real orchestration code in a vm context with only the browser,
// audio, network and storage boundaries replaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const MAIN_SOURCE = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

/** One top-level `function name(` or `async function name(`, by brace matching. */
export function mainFunctionSource(name, source = MAIN_SOURCE) {
  const re = new RegExp(`\\n(async )?function ${name}\\(`);
  const m = re.exec(source);
  assert.ok(m, `main.js defines ${name}`);
  let i = m.index + m[0].length;
  let paren = 1;
  while (paren) { const c = source[i++]; if (c === '(') paren++; else if (c === ')') paren--; }
  while (source[i] !== '{') i++;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(m.index + 1, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/** Several functions, joined, ready for vm.runInContext. */
export function mainFunctions(names, source = MAIN_SOURCE) {
  return names.map((name) => mainFunctionSource(name, source)).join('\n\n');
}
