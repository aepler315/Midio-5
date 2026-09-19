import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MissingAuthSecretError,
  isPersistentAuthDeployment,
  persistentAuthReason,
  resolveAuthSecret,
} from "./secret.ts";

test("local preview without a database is ephemeral", () => {
  assert.equal(isPersistentAuthDeployment({ NODE_ENV: "development" }), false);
  assert.equal(persistentAuthReason({ NODE_ENV: "development" }), null);
  assert.equal(
    isPersistentAuthDeployment({ BETTER_AUTH_URL: "http://localhost:8080" }),
    false,
  );
});

test("production, a database, or a public auth URL is persistent", () => {
  assert.equal(isPersistentAuthDeployment({ NODE_ENV: "production" }), true);
  assert.equal(isPersistentAuthDeployment({ DATABASE_URL: "postgres://db/midio" }), true);
  assert.equal(
    isPersistentAuthDeployment({ BETTER_AUTH_URL: "https://midio.example.com" }),
    true,
  );
});

test("a configured secret is used in every mode", () => {
  const secret = "stable-shared-secret";
  assert.equal(
    resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret }, () => "preview"),
    secret,
  );
  assert.equal(
    resolveAuthSecret({ DATABASE_URL: "postgres://db/midio", BETTER_AUTH_SECRET: ` ${secret} ` }, () => "preview"),
    secret,
  );
  assert.equal(
    resolveAuthSecret({ NODE_ENV: "development", BETTER_AUTH_SECRET: secret }, () => "preview"),
    secret,
  );
});

test("two resolvers with the same configured secret agree", () => {
  const env = { NODE_ENV: "production", BETTER_AUTH_SECRET: "shared-across-instances" };
  assert.equal(resolveAuthSecret(env, () => "a"), resolveAuthSecret(env, () => "b"));
});

test("production-shaped config without a secret fails before serving", () => {
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: "production" }, () => "preview"),
    (err: unknown) => {
      assert.ok(err instanceof MissingAuthSecretError);
      assert.match(err.message, /NODE_ENV=production/);
      return true;
    },
  );
  assert.throws(
    () => resolveAuthSecret({ DATABASE_URL: "postgres://db/midio" }, () => "preview"),
    /DATABASE_URL/,
  );
  assert.throws(
    () => resolveAuthSecret({ BETTER_AUTH_URL: "https://app.example" }, () => "preview"),
    /BETTER_AUTH_URL/,
  );
});

test("whitespace-only secrets are treated as missing", () => {
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "   " }, () => "preview"),
    MissingAuthSecretError,
  );
});

test("ephemeral local mode may mint a preview secret", () => {
  let minted = 0;
  const secret = resolveAuthSecret({ NODE_ENV: "development" }, () => {
    minted += 1;
    return "process-local";
  });
  assert.equal(secret, "process-local");
  assert.equal(minted, 1);
});
