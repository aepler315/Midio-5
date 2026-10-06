import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['index.html', 'CNAME', 'src/main.js', 'soundfonts'];

function overlaps(a, b) {
  const rel = path.relative(a, b);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

export async function canonicalPath(target) {
  const missing = [];
  let cursor = target;
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      return path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return target;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Range v2 delivery checks on a staged tree: the local renderer bundle must
 * be exactly what tools/build-range-runtime.mjs builds from the locked
 * dependencies (rebuilt here when they are installed), and every view in
 * the runtime scene catalog must ship its real terrain manifest and payload
 * with the hashes the catalog and manifest declare -- no LFS pointers, no
 * unresolved slots. Skipped for trees that carry no Range v2 runtime.
 */
export async function verifyRangeRuntime(sourceDir, outputDir) {
  const vendor = path.join(outputDir, 'src', 'vendor', 'range');
  let runtime;
  try { runtime = JSON.parse(await fs.readFile(path.join(vendor, 'runtime.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { checked: false };
    throw new Error(`Invalid Range runtime metadata: ${error.message}`, { cause: error });
  }
  for (const [name, want] of Object.entries(runtime.files)) {
    const buf = await fs.readFile(path.join(vendor, name));
    if (sha256(buf) !== want.sha256) throw new Error(`staged src/vendor/range/${name} does not match runtime.json`);
  }
  // Rebuild the bundle from the installed Three.js and compare it with the
  // committed one. Only a checkout without dependencies skips this (it
  // cannot build); any build failure or mismatch fails staging.
  let rebuilt = false;
  let installed = true;
  try { await fs.access(path.join(sourceDir, 'node_modules', 'three', 'package.json')); } catch { installed = false; }
  if (installed) {
    const { buildRangeRuntime } = await import(pathToFileURL(path.join(sourceDir, 'tools', 'build-range-runtime.mjs')).href);
    const { code } = await buildRangeRuntime();
    if (sha256(code) !== runtime.files['three-range.module.js'].sha256) {
      throw new Error('committed Range runtime bundle is stale; run node tools/build-range-runtime.mjs');
    }
    rebuilt = true;
  }
  const catalogPath = path.join(outputDir, 'src', 'world', 'terrain', 'sceneCatalogData.js');
  const views = [];
  // A Range-enabled build (runtime.json exists) imports the catalog in its
  // module graph: a missing catalog is a broken site, not a skipped check.
  let catalog;
  try { ({ default: catalog } = await import(`${pathToFileURL(catalogPath).href}?stage=${Date.now()}`)); } catch (err) {
    throw new Error(`Range runtime is staged but its scene catalog cannot be loaded: ${err.message}`, { cause: err });
  }
  {
    const root = path.join(outputDir, 'src', 'assets', 'range', 'v2');
    for (const view of catalog.views) {
      const manifestBuf = await fs.readFile(path.join(root, view.terrainManifestUrl));
      if (manifestBuf.subarray(0, 40).toString().startsWith('version https://git-lfs')) throw new Error(`${view.id} manifest is an LFS pointer`);
      if (view.terrainManifestSha256 && sha256(manifestBuf) !== view.terrainManifestSha256) throw new Error(`${view.id} manifest hash differs from the catalog`);
      const manifest = JSON.parse(manifestBuf.toString('utf8'));
      const payload = await fs.readFile(path.join(root, path.dirname(view.terrainManifestUrl), manifest.payload.url));
      if (payload.byteLength !== manifest.payload.byteLength || sha256(payload) !== manifest.payload.sha256) {
        throw new Error(`${view.id} terrain payload does not match its manifest`);
      }
      // The view's material pack and every data texture it names.
      const matBuf = await fs.readFile(path.join(root, view.materialManifestUrl));
      if (view.materialManifestSha256 && sha256(matBuf) !== view.materialManifestSha256) throw new Error(`${view.id} material manifest hash differs from the catalog`);
      const mat = JSON.parse(matBuf.toString('utf8'));
      for (const t of Object.values(mat.textures || {})) {
        const tex = await fs.readFile(path.join(root, path.dirname(view.materialManifestUrl), t.url));
        if (tex.byteLength !== t.bytes || sha256(tex) !== t.sha256) throw new Error(`${view.id} material texture ${t.id} does not match its pack`);
      }
      views.push(view.id);
    }
  }
  return { checked: true, rebuilt, views };
}

export async function assertStagePaths(sourceDir, outputDir) {
  const source = path.resolve(sourceDir);
  const output = path.resolve(outputDir);
  const [canonicalSource, canonicalOutput] = await Promise.all([
    canonicalPath(source), canonicalPath(output),
  ]);
  if (overlaps(canonicalOutput, canonicalSource)) {
    throw new Error('Stage output must be separate from the source directory.');
  }
  // In-tree staging is intentionally limited to the repository's dedicated
  // artifact directory. Accepting an arbitrary descendant (notably `src` or
  // `soundfonts`) makes the cleanup below a source-code deletion primitive.
  if (overlaps(canonicalSource, canonicalOutput)
    && path.relative(canonicalSource, canonicalOutput) !== '_site') {
    throw new Error('Stage output inside the source must be its dedicated _site directory.');
  }
  return { source, output };
}

export async function assertRegularTree(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`Public runtime symlink is forbidden: ${target}`);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target)) await assertRegularTree(path.join(target, name));
  } else if (!stat.isFile()) throw new Error(`Public runtime input must be a regular file: ${target}`);
}

export async function stageSite(sourceDir, outputDir) {
  const { source, output } = await assertStagePaths(sourceDir, outputDir);
  for (const required of REQUIRED) {
    try { await fs.access(path.join(source, required)); }
    catch { throw new Error(`Missing required runtime input: ${required}`); }
  }

  for (const input of ['index.html', 'CNAME', 'src', 'soundfonts']) await assertRegularTree(path.join(source, input));

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(source, 'index.html'), path.join(output, 'index.html')),
    fs.copyFile(path.join(source, 'CNAME'), path.join(output, 'CNAME')),
    fs.cp(path.join(source, 'src'), path.join(output, 'src'), { recursive: true }),
    fs.cp(path.join(source, 'soundfonts'), path.join(output, 'soundfonts'), { recursive: true }),
    fs.writeFile(path.join(output, '.nojekyll'), ''),
  ]);
  await verifyRangeRuntime(source, output);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const source = process.argv[2] || '.';
  const output = process.argv[3] || '_site';
  stageSite(source, output).then((dir) => console.log(`Staged site at ${dir}`)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
