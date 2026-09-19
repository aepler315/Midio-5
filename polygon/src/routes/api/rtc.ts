import { createFileRoute } from "@tanstack/react-router";
import { assertSameSiteRequest } from "@/lib/auth/isolation.server";
import { requireUserId } from "@/lib/auth/verify.server";
import {
  RTC_RELAY_LIMITS,
  assertRtcIdentifier,
  createSignalingState,
  leaveRtcPeer,
  pollRtcRoom,
  pruneSignalingState,
  queueRtcSignal,
  registerRtcPeer,
  RtcRelayError,
  type RelaySignalKind,
} from "@/lib/multiplayer/signaling";

const relay = (globalThis as typeof globalThis & {
  __midioRtcRelay__?: ReturnType<typeof createSignalingState>;
}).__midioRtcRelay__ ??= createSignalingState();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: unknown): Response {
  const status = error instanceof RtcRelayError
    ? error.status
    : typeof error === "object" && error && "status" in error && Number.isInteger(error.status)
      ? Number(error.status)
      : 500;
  const message = status >= 500 ? "RTC signaling failed" : (error as Error)?.message || "Bad request";
  if (status >= 500) console.error("[rtc] signaling route failed", error);
  return json({ error: message }, status);
}

function queryValue(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (value === null) throw new RtcRelayError(`Missing ${key}`, 400);
  return value;
}

function sinceValue(value: string | null): number {
  if (value === null || value === "") return 0;
  const since = Number(value);
  if (!Number.isSafeInteger(since) || since < 0) throw new RtcRelayError("Invalid signal cursor", 400);
  return since;
}

async function authorizedUser(): Promise<string> {
  assertSameSiteRequest();
  return requireUserId();
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > RTC_RELAY_LIMITS.maxSignalPayloadChars + 4096) {
    throw new RtcRelayError("Request body is too large", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new RtcRelayError("Request body must be valid JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RtcRelayError("Request body must be an object", 400);
  }
  return body as Record<string, unknown>;
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new RtcRelayError(`Missing ${key}`, 400);
  return value;
}

function signalKind(value: unknown): RelaySignalKind {
  if (value === "offer" || value === "answer" || value === "ice") return value;
  throw new RtcRelayError("Invalid RTC signal kind", 400);
}

export const Route = createFileRoute("/api/rtc")({
  server: {
    handlers: {
      GET: async ({ request }) => {
    try {
      const userId = await authorizedUser();
      const url = new URL(request.url);
      const room = assertRtcIdentifier(queryValue(url, "room"), "room");
      const peer = assertRtcIdentifier(queryValue(url, "peer"), "peer");
      const name = (url.searchParams.get("name") ?? "").slice(0, RTC_RELAY_LIMITS.maxNameChars);
      registerRtcPeer(relay, { room, peer, name, userId });
      pruneSignalingState(relay);
      return json(pollRtcRoom(relay, {
        room, peer, userId, since: sinceValue(url.searchParams.get("since")),
      }));
    } catch (error) {
      return errorResponse(error);
    }
      },
      POST: async ({ request }) => {
    try {
      const userId = await authorizedUser();
      const body = await readJson(request);
      const room = assertRtcIdentifier(bodyString(body, "room"), "room");
      const peerValue = body.peer ?? body.from;
      if (typeof peerValue !== "string") throw new RtcRelayError("Missing peer", 400);
      const peer = assertRtcIdentifier(peerValue, "peer");
      const op = bodyString(body, "op");
      if (op === "leave") {
        leaveRtcPeer(relay, { room, peer, userId });
        return json({ ok: true });
      }
      if (op !== "signal") throw new RtcRelayError("Invalid RTC operation", 400);
      const to = assertRtcIdentifier(bodyString(body, "to"), "peer");
      queueRtcSignal(relay, {
        room, from: peer, to, kind: signalKind(body.kind), payload: body.payload, userId,
      });
      return json({ ok: true }, 202);
    } catch (error) {
      return errorResponse(error);
    }
      },
    },
  },
});
