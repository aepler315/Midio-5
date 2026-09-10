import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = resolve(root, 'tools/serve.js');

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch { /* the child is still binding */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('development server did not start');
}

test('development server rejects traversal, malformed URLs, and arbitrary download URLs without dying', async () => {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile, String(port)], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  try {
    await waitForServer(baseUrl);
    assert.equal((await fetch(baseUrl)).status, 200);
    assert.equal((await fetch(`${baseUrl}/%ZZ`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/..%2fpackage.json`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/package.json`)).status, 404);

    const download = await fetch(`${baseUrl}/api/soulseek/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { source: 'free', url: 'http://127.0.0.1:9/not-a-catalog-track' } }),
    });
    assert.equal(download.status, 500);
    assert.match(await download.text(), /No free download URL/);

    // A rejected request is never allowed to take down the dev server.
    assert.equal((await fetch(`${baseUrl}/src/main.js`)).status, 200);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
