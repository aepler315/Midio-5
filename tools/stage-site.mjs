import fs from 'node:fs/promises';
import path from 'node:path';
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
