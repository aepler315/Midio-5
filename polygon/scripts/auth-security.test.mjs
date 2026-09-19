import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

test("preview auth source contains no client secret or secret-shaped fallback", () => {
  const preview = read("src/lib/auth/preview.ts");
  assert.doesNotMatch(preview, /PREVIEW_CLIENT_SECRET/);
  assert.doesNotMatch(preview, /[A-Fa-f0-9]{64}/);
});

test("server auth requires an injected secret and shared-user mode is opt-in", () => {
  const server = read("src/lib/auth/server.ts");
  const verify = read("src/lib/auth/verify.server.ts");
  assert.match(server, /GROK_AUTH_CLIENT_SECRET/);
  assert.doesNotMatch(server, /PREVIEW_CLIENT_SECRET/);
  assert.match(verify, /MIDIO_ALLOW_SHARED_DEV_USER/);
  assert.match(verify, /throw new UnauthorizedError/);
});
