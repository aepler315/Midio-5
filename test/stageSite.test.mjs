import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageSite } from '../tools/stage-site.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midio-stage-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'site');
  await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.mkdir(path.join(source, 'soundfonts'), { recursive: true });
  await fs.writeFile(path.join(source, 'index.html'), '<script type="module" src="src/main.js"></script>');
  await fs.writeFile(path.join(source, 'CNAME'), 'example.test\n');
  await fs.writeFile(path.join(source, 'src/main.js'), 'export const boot = true;\n');
  await fs.writeFile(path.join(source, 'soundfonts/README.md'), 'runtime listing\n');
  await fs.writeFile(path.join(source, 'secret.txt'), 'do not publish\n');
  return { root, source, output };
}

test('stageSite writes only the public runtime contract', async (t) => {
  const { root, source, output } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await stageSite(source, output);
  assert.deepEqual((await fs.readdir(output)).sort(), ['.nojekyll', 'CNAME', 'index.html', 'soundfonts', 'src']);
  assert.equal(await fs.readFile(path.join(output, 'src/main.js'), 'utf8'), 'export const boot = true;\n');
  await assert.rejects(fs.access(path.join(output, 'secret.txt')));
});

test('stageSite fails when a required runtime input is missing', async (t) => {
  const { root, source, output } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(source, 'src/main.js'));
  await assert.rejects(stageSite(source, output), /required runtime input.*src\/main\.js/i);
});

test('stageSite refuses to clean a source directory or one of its ancestors', async (t) => {
  const { root, source } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(stageSite(source, source), /output.*source/i);
  await assert.rejects(stageSite(source, root), /output.*source/i);
});

test('stageSite refuses arbitrary source descendants before deleting them', async (t) => {
  const { root, source } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = path.join(source, 'src/main.js');
  await assert.rejects(stageSite(source, path.join(source, 'src')), /dedicated _site/i);
  assert.equal(await fs.readFile(main, 'utf8'), 'export const boot = true;\n');
});

test('stageSite follows symlinked ancestors when checking destructive overlap', async (t) => {
  const { root, source } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const alias = path.join(root, 'source-alias');
  await fs.symlink(source, alias, 'dir');
  await assert.rejects(stageSite(source, path.join(alias, 'src')), /dedicated _site/i);
  assert.equal(await fs.readFile(path.join(source, 'src/main.js'), 'utf8'), 'export const boot = true;\n');
});

test('staging verifies the Range v2 runtime bundle and shipped terrain assets', async () => {
  const { verifyRangeRuntime } = await import('../tools/stage-site.mjs');
  const fsp = fs, p = path;
  // fileURLToPath: URL.pathname is not a filesystem path on Windows.
  const root = p.resolve(p.dirname(fileURLToPath(import.meta.url)), '..');
  const out = await fsp.mkdtemp(p.join(os.tmpdir(), 'midio-stage-range-'));
  await fsp.cp(p.join(root, 'src'), p.join(out, 'src'), { recursive: true });
  const ok = await verifyRangeRuntime(root, out);
  assert.equal(ok.checked, true);
  assert.ok(ok.views.length >= 1);
  // A tampered payload must fail staging.
  const payload = p.join(out, 'src', 'assets', 'range', 'v2', 'terrain', `${ok.views[0]}.terrain.bin.gz`);
  const buf = await fsp.readFile(payload);
  buf[buf.length - 10] ^= 0xff;
  await fsp.writeFile(payload, buf);
  await assert.rejects(verifyRangeRuntime(root, out), /does not match/);
  // A staged runtime without its scene catalog is a broken site.
  await fsp.rm(p.join(out, 'src', 'world', 'terrain', 'sceneCatalogData.js'));
  await assert.rejects(verifyRangeRuntime(root, out), /scene catalog cannot be loaded/);
  await fsp.rm(out, { recursive: true, force: true });
});
