import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['index.html', 'CNAME', 'src/main.js', 'soundfonts'];

function overlaps(a, b) {
  const rel = path.relative(a, b);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

async function canonicalPath(target) {
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
  catch { return { checked: false }; }
  for (const [name, want] of Object.entries(runtime.files)) {
    const buf = await fs.readFile(path.join(vendor, name));
    if (sha256(buf) !== want.sha256) throw new Error(`staged src/vendor/range/${name} does not match runtime.json`);
  }
  let rebuilt = false;
  try {
    await fs.access(path.join(sourceDir, 'node_modules', 'three', 'package.json'));
    const { buildRangeRuntime } = await import(pathToFileURL(path.join(sourceDir, 'tools', 'build-range-runtime.mjs')).href);
    const { code } = await buildRangeRuntime();
    if (sha256(code) !== runtime.files['three-range.module.js'].sha256) {
      throw new Error('committed Range runtime bundle is stale; run node tools/build-range-runtime.mjs');
    }
    rebuilt = true;
  } catch (err) {
    if (/stale/.test(err.message)) throw err;
  }
  const catalogPath = path.join(outputDir, 'src', 'world', 'terrain', 'sceneCatalogData.js');
  const views = [];
  try {
    const { default: catalog } = await import(`${pathToFileURL(catalogPath).href}?stage=${Date.now()}`);
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
      views.push(view.id);
    }
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && !views.length) return { checked: true, rebuilt, views };
    throw err;
  }
  return { checked: true, rebuilt, views };
}

export async function stageSite(sourceDir, outputDir) {
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
  for (const required of REQUIRED) {
    try { await fs.access(path.join(source, required)); }
    catch { throw new Error(`Missing required runtime input: ${required}`); }
  }

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
