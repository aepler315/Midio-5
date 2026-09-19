export type RelaySignalKind = "offer" | "answer" | "ice";

export interface RelayPeer {
  id: string;
  name: string;
  userId: string;
  lastSeen: number;
}

export interface RelaySignal {
  id: number;
  room: string;
  from: string;
  to: string;
  kind: RelaySignalKind;
  payload: unknown;
  createdAt: number;
}

export interface SignalingState {
  nextSignalId: number;
  rooms: Map<string, { peers: Map<string, RelayPeer>; signals: RelaySignal[] }>;
}

export const RTC_RELAY_LIMITS = Object.freeze({
  maxRooms: 256,
  maxPeersPerRoom: 32,
  maxRoomChars: 128,
  maxPeerChars: 128,
  maxNameChars: 80,
  maxSignalPayloadChars: 256 * 1024,
  peerTtlMs: 45_000,
  signalTtlMs: 60_000,
  maxSignalsPerRoom: 2048,
});

export function createSignalingState(): SignalingState {
  return { nextSignalId: 1, rooms: new Map() };
}

export class RtcRelayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "RtcRelayError";
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f;
  }).join("");
}

export function assertRtcIdentifier(
  value: string,
  label: "room" | "peer",
): string {
  const max = label === "room" ? RTC_RELAY_LIMITS.maxRoomChars : RTC_RELAY_LIMITS.maxPeerChars;
  const valueTrimmed = value.trim();
  if (!valueTrimmed || valueTrimmed.length > max || containsControlCharacter(valueTrimmed)) {
    throw new RtcRelayError(`Invalid ${label} identifier`, 400);
  }
  return valueTrimmed;
}

export function normalizePeerName(name: string): string {
  return stripControlCharacters(name).trim().slice(0, RTC_RELAY_LIMITS.maxNameChars);
}

function roomFor(state: SignalingState, room: string) {
  let entry = state.rooms.get(room);
  if (!entry) {
    if (state.rooms.size >= RTC_RELAY_LIMITS.maxRooms) {
      throw new RtcRelayError("Too many active RTC rooms", 429);
    }
    entry = { peers: new Map(), signals: [] };
    state.rooms.set(room, entry);
  }
  return entry;
}

export function pruneSignalingState(state: SignalingState, now = Date.now()): void {
  for (const [roomId, room] of state.rooms) {
    for (const [peerId, peer] of room.peers) {
      if (now - peer.lastSeen > RTC_RELAY_LIMITS.peerTtlMs) room.peers.delete(peerId);
    }
    room.signals = room.signals.filter((signal) => now - signal.createdAt <= RTC_RELAY_LIMITS.signalTtlMs);
    const alive = new Set(room.peers.keys());
    room.signals = room.signals.filter((signal) => alive.has(signal.from) && alive.has(signal.to));
    if (room.peers.size === 0) state.rooms.delete(roomId);
  }
}

export function registerRtcPeer(
  state: SignalingState,
  { room: roomId, peer: peerId, name, userId, now = Date.now() }: {
    room: string;
    peer: string;
    name: string;
    userId: string;
    now?: number;
  },
): void {
  pruneSignalingState(state, now);
  const room = roomFor(state, roomId);
  const existing = room.peers.get(peerId);
  if (existing && existing.userId !== userId) {
    throw new RtcRelayError("Peer identifier is already in use", 403);
  }
  if (!existing && room.peers.size >= RTC_RELAY_LIMITS.maxPeersPerRoom) {
    throw new RtcRelayError("RTC room is full", 429);
  }
  room.peers.set(peerId, {
    id: peerId,
    name: normalizePeerName(name),
    userId,
    lastSeen: now,
  });
}

export function pollRtcRoom(
  state: SignalingState,
  { room: roomId, peer: peerId, userId, since, now = Date.now() }: {
    room: string;
    peer: string;
    userId: string;
    since: number;
    now?: number;
  },
): { peers: Array<{ id: string; name: string }>; signals: Array<Omit<RelaySignal, "room" | "createdAt">> } {
  pruneSignalingState(state, now);
  const room = state.rooms.get(roomId)!;
  const current = room?.peers.get(peerId);
  if (!room || !current) throw new RtcRelayError("RTC peer is not registered", 409);
  if (current.userId !== userId) throw new RtcRelayError("Peer identifier is already in use", 403);
  current.lastSeen = now;
  return {
    peers: [...room.peers.values()].map(({ id, name }) => ({ id, name })),
    signals: room.signals
      .filter((signal) => signal.to === peerId && signal.id > since)
      .map(({ room: _room, createdAt: _createdAt, ...signal }) => signal),
  };
}

export function queueRtcSignal(
  state: SignalingState,
  { room: roomId, from, to, kind, payload, userId, now = Date.now() }: {
    room: string;
    from: string;
    to: string;
    kind: RelaySignalKind;
    payload: unknown;
    userId: string;
    now?: number;
  },
): void {
  pruneSignalingState(state, now);
  const room = state.rooms.get(roomId);
  const sender = room?.peers.get(from);
  const receiver = room?.peers.get(to);
  if (!room || !sender || !receiver) throw new RtcRelayError("RTC peer is not registered", 409);
  if (sender.userId !== userId) throw new RtcRelayError("Peer identifier is already in use", 403);
  sender.lastSeen = now;
  const payloadJson = JSON.stringify(payload);
  if (payloadJson === undefined) throw new RtcRelayError("RTC signal payload is invalid", 400);
  if (payloadJson.length > RTC_RELAY_LIMITS.maxSignalPayloadChars) {
    throw new RtcRelayError("RTC signal payload is too large", 413);
  }
  room.signals.push({
    id: state.nextSignalId++, room: roomId, from, to, kind, payload, createdAt: now,
  });
  if (room.signals.length > RTC_RELAY_LIMITS.maxSignalsPerRoom) {
    room.signals.splice(0, room.signals.length - RTC_RELAY_LIMITS.maxSignalsPerRoom);
  }
}

export function leaveRtcPeer(
  state: SignalingState,
  { room: roomId, peer: peerId, userId, now = Date.now() }: {
    room: string;
    peer: string;
    userId: string;
    now?: number;
  },
): void {
  pruneSignalingState(state, now);
  const room = state.rooms.get(roomId);
  const peer = room?.peers.get(peerId);
  if (!room || !peer) return;
  if (peer.userId !== userId) throw new RtcRelayError("Peer identifier is already in use", 403);
  room.peers.delete(peerId);
  room.signals = room.signals.filter((signal) => signal.from !== peerId && signal.to !== peerId);
  if (room.peers.size === 0) state.rooms.delete(roomId);
}
