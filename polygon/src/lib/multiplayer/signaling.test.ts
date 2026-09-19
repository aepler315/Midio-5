import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSignalingState,
  leaveRtcPeer,
  pollRtcRoom,
  queueRtcSignal,
  registerRtcPeer,
  RtcRelayError,
} from "./signaling.ts";

test("RTC signaling registers peers, routes only addressed signals, and binds peer ids to users", () => {
  const state = createSignalingState();
  registerRtcPeer(state, { room: "room", peer: "alice", name: "A", userId: "user-a", now: 1 });
  registerRtcPeer(state, { room: "room", peer: "bob", name: "B", userId: "user-b", now: 1 });

  queueRtcSignal(state, {
    room: "room", from: "bob", to: "alice", kind: "offer", payload: { sdp: "x" }, userId: "user-b", now: 2,
  });
  const alice = pollRtcRoom(state, { room: "room", peer: "alice", userId: "user-a", since: 0, now: 3 });
  const bob = pollRtcRoom(state, { room: "room", peer: "bob", userId: "user-b", since: 0, now: 3 });
  assert.deepEqual(alice.signals.map((signal) => signal.from), ["bob"]);
  assert.deepEqual(bob.signals, []);
  assert.deepEqual(alice.peers, [
    { id: "alice", name: "A" },
    { id: "bob", name: "B" },
  ]);
  assert.throws(
    () => registerRtcPeer(state, { room: "room", peer: "alice", name: "spoof", userId: "user-b", now: 4 }),
    (error) => error instanceof RtcRelayError && error.status === 403,
  );
});

test("RTC signaling expires inactive peers and their queued signals", () => {
  const state = createSignalingState();
  registerRtcPeer(state, { room: "room", peer: "alice", name: "A", userId: "user-a", now: 0 });
  registerRtcPeer(state, { room: "room", peer: "bob", name: "B", userId: "user-b", now: 0 });
  queueRtcSignal(state, {
    room: "room", from: "alice", to: "bob", kind: "ice", payload: {}, userId: "user-a", now: 1,
  });
  pollRtcRoom(state, { room: "room", peer: "bob", userId: "user-b", since: 0, now: 30_000 });
  const afterExpiry = pollRtcRoom(state, {
    room: "room", peer: "bob", userId: "user-b", since: 0, now: 60_000,
  });
  assert.deepEqual(afterExpiry.peers, [{ id: "bob", name: "B" }]);
  assert.deepEqual(afterExpiry.signals, []);
  assert.doesNotThrow(() => leaveRtcPeer(state, { room: "room", peer: "bob", userId: "user-b", now: 60_001 }));
});
