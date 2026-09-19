/**
 * Better Auth signing/encryption secret.
 *
 * Preview and local `npm run dev` may mint a process-local secret so HMR does
 * not invalidate PGLite-backed sessions. A production-shaped deployment —
 * NODE_ENV=production, a real DATABASE_URL, or a public BETTER_AUTH_URL —
 * must supply BETTER_AUTH_SECRET. Falling back to random bytes there makes
 * multi-instance and restarted processes disagree about sessions.
 */
export class MissingAuthSecretError extends Error {
  constructor(reason: string) {
    super(
      `BETTER_AUTH_SECRET is required for ${reason}. ` +
        "A process-local preview secret is only valid for ephemeral local/preview mode.",
    );
    this.name = "MissingAuthSecretError";
  }
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || host === "127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function publicAuthUrl(value: string | undefined): string | undefined {
  const raw = trimEnv(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return raw;
    return isLoopbackHostname(url.hostname) ? undefined : raw;
  } catch {
    return raw;
  }
}

export type AuthSecretEnv = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
};

/** True when sessions or signing material would outlive this process. */
export function isPersistentAuthDeployment(env: AuthSecretEnv = process.env): boolean {
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production") return true;
  if (trimEnv(env.DATABASE_URL)) return true;
  return Boolean(publicAuthUrl(env.BETTER_AUTH_URL));
}

export function persistentAuthReason(env: AuthSecretEnv = process.env): string | null {
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production") return "NODE_ENV=production";
  if (trimEnv(env.DATABASE_URL)) return "DATABASE_URL";
  const url = publicAuthUrl(env.BETTER_AUTH_URL);
  if (url) return `BETTER_AUTH_URL=${url}`;
  return null;
}

/**
 * Return the configured secret, or a preview secret in ephemeral mode.
 * Throws MissingAuthSecretError instead of minting a random value for a
 * persistent deployment.
 */
export function resolveAuthSecret(
  env: AuthSecretEnv = process.env,
  previewSecret: () => string,
): string {
  const configured = trimEnv(env.BETTER_AUTH_SECRET);
  if (configured) return configured;
  const reason = persistentAuthReason(env);
  if (reason) throw new MissingAuthSecretError(reason);
  return previewSecret();
}
