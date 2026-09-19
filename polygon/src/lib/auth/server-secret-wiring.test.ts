import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(join(dir, "server.ts"), "utf8");

test("production auth wiring calls resolveAuthSecret instead of preview fallback", () => {
  assert.match(server, /import \{ resolveAuthSecret \} from "\.\/secret"/);
  assert.match(server, /secret:\s*resolveAuthSecret\(/);
  assert.doesNotMatch(
    server,
    /secret:\s*env\("BETTER_AUTH_SECRET"\)\s*\?\?\s*previewAuthSecret\(\)/,
  );
});
