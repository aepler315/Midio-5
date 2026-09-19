import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOKAHEAD_SEC,
  MAX_SCHEDULED_BEATS,
  planSchedule,
} from "./audio.ts";

test("a long hidden interval skips stale beats instead of scheduling each one", () => {
  const beat = 0.5; // 120 bpm
  const now = 40; // 80 missed beats
  const planned = planSchedule({
    now,
    nextKickAudio: 0,
    beatIndex: 0,
    bpm: 120,
  });
  assert.ok(planned.skipped >= 79, `expected a large skip, got ${planned.skipped}`);
  assert.ok(planned.times.length <= MAX_SCHEDULED_BEATS);
  assert.equal(planned.times.length, 2, "only grid beats inside the lookahead window are scheduled");
  assert.ok(planned.times[0]! >= now - 1e-9);
  assert.ok(planned.times.at(-1)! < now + LOOKAHEAD_SEC + beat);
  const grid = planned.times.map((t) => t / beat);
  for (const g of grid) assert.ok(Math.abs(g - Math.round(g)) < 1e-9, "phase left the 0.5s grid");
  assert.equal(planned.beatIndex, planned.skipped + planned.times.length);
});

test("an on-time scheduler still fills only the lookahead window", () => {
  const planned = planSchedule({
    now: 10,
    nextKickAudio: 10,
    beatIndex: 4,
    bpm: 120,
  });
  assert.equal(planned.skipped, 0);
  assert.ok(planned.times.length >= 1);
  assert.ok(planned.times.length <= MAX_SCHEDULED_BEATS);
  assert.equal(planned.times[0], 10);
  assert.equal(planned.indices[0], 4);
});

test("skip-only planning advances the cursor without queuing notes", () => {
  const planned = planSchedule({
    now: 12.25,
    nextKickAudio: 0,
    beatIndex: 0,
    bpm: 120,
    maxBeats: 0,
  });
  assert.equal(planned.times.length, 0);
  assert.ok(planned.skipped > 0);
  assert.ok(planned.nextKickAudio >= 12.25);
});
