// Range v2 shaders are GLSL strings node cannot compile, and a shader that
// fails to compile draws nothing without throwing (the terrain once vanished
// that way). This catches the static mistake that caused it: a function
// called above its own definition in the same source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('src/world/alpine');
const TYPES = 'void|float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|Tri|[A-Z][A-Za-z0-9]*';
const DEF = new RegExp(`^\\s*(?:${TYPES})\\s+([A-Za-z_]\\w*)\\s*\\([^;{]*\\)\\s*\\{`, 'gm');

function glslLiterals(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const out = [];
  const re = /\/\* glsl \*\/`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) out.push({ at: src.slice(0, m.index).split('\n').length, body: m[1].replace(/\$\{[^}]*\}/g, '') });
  return out;
}

test('every GLSL helper is defined before its first call', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  let checked = 0;
  for (const file of files) {
    for (const { at, body } of glslLiterals(file)) {
      const defs = new Map();
      for (const d of body.matchAll(DEF)) if (d[1] !== 'main' && !defs.has(d[1])) defs.set(d[1], d.index);
      for (const [name, defAt] of defs) {
        const call = new RegExp(`\\b${name}\\s*\\(`, 'g');
        for (const c of body.matchAll(call)) {
          if (c.index >= defAt) break;
          assert.fail(`${file}:${at} calls ${name}() before defining it`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 10, `helpers checked: ${checked}`);
});
