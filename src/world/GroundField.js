// The ground as a conveyor of EQ-bar-shaped slices (follow-up item 5):
// each slice's height echoes a shifted per-band energy reading from the
// same 7-band EnergyCurves the horizon EQ reads, so the terrain visually
// rhymes with the music playing far in the background, just offset by a
// few bars. Slices are baked at generation time and simply scroll by
// afterward (a rolling waveform, not something that keeps changing shape
// once it's passed) — with an occasional scripted "the ground gives way,
// then recovers spectacularly" gag layered on top.
import { clamp01, mulberry32, hashSeed, shuffle } from '../utils/math.js';
import { Role } from '../core/NoteEvent.js';

const SLICE_WIDTH_PX = 90;
const NUM_BANDS = 7;
const BAND_SHIFT = 3;
const RISE_AMPLITUDE_PX = 30; // how far energy alone can lift a slice
const SPRING_K = 40, SPRING_C = 12; // per-slice settle spring (critically-damped-ish)
const RECOVER_C = 4; // reduced damping during recovery -> elastic overshoot
const RECOVER_DURATION_MS = 700; // how long the softened damping lasts
const LOOKAHEAD_PX = 1600;
const TRIM_BEHIND_PX = 300;

const GAG_LEAD_PX = 420; // how far ahead of Midio a gag is seeded, so it's visible before he reaches it
const GAG_SLICE_COUNT = 7;
const GAG_STAGGER_MS = 90;
const GAG_SAG_PX = 70;
const GAG_HOLD_MS = 500;
const GAG_KICK_SYNC_WINDOW_MS = 150;

class Slice {
  constructor(index, worldXStart) {
    this.index = index;
    this.worldXStart = worldXStart;
    this.baseTarget = 0;
    this.offset = 0;
    this.vel = 0;
    this.gagTarget = null; // non-null while a gag is actively overriding this slice
    this.recoverUntilMs = -Infinity;
  }
}

export class GroundField {
  constructor(baseGroundY, { conductor, durationMs = 0, songSeed = 1, sliceWidth = SLICE_WIDTH_PX } = {}) {
    this.baseGroundY = baseGroundY;
    this.sliceWidth = sliceWidth;
    this.conductor = conductor;
    this.slices = [];
    this._nextIndex = 0;
    this._nextWorldXStart = -TRIM_BEHIND_PX;
    this.justRecovered = false;

    this._gagQueue = this._scheduleGags(durationMs, conductor?.barGrid, songSeed);
    this._activeGagSliceIdxs = null;

    this._buzz = 0; // EMA of bass energy, driving a render-only micro-vibration
    this._nowMs = 0;
  }

  _scheduleGags(durationMs, barGrid, seed) {
    if (!durationMs || durationMs < 15000) return []; // too short for a scripted gag to land well
    const rand = mulberry32(hashSeed(`${seed}:gag`));
    const candidateTimes = (barGrid && barGrid.length > 8)
      ? barGrid.map((b) => b.ms)
      : Array.from({ length: 24 }, (_, i) => (i / 24) * durationMs);

    const backHalf = candidateTimes.filter((t) => t >= durationMs * 0.5 && t <= durationMs * 0.92);
    if (backHalf.length === 0) return [];

    const numGags = durationMs > 70000 ? 2 : 1;
    const minGapMs = durationMs * 0.2;
    const shuffled = shuffle(backHalf, rand);
    const chosen = [];
    for (const t of shuffled) {
      if (chosen.every((c) => Math.abs(c - t) >= minGapMs)) chosen.push(t);
      if (chosen.length >= numGags) break;
    }
    return chosen.sort((a, b) => a - b);
  }

  _spawnSlicesUpTo(worldXLimit) {
    while (this._nextWorldXStart < worldXLimit) {
      this.slices.push(new Slice(this._nextIndex, this._nextWorldXStart));
      this._nextIndex++;
      this._nextWorldXStart += this.sliceWidth;
    }
  }

  _trimBehind(worldX) {
    while (this.slices.length && this.slices[0].worldXStart + this.sliceWidth < worldX - TRIM_BEHIND_PX) {
      this.slices.shift();
    }
  }

  _maybeTriggerGag(nowMs, worldX) {
    if (this._gagQueue.length === 0) return;
    if (nowMs < this._gagQueue[0]) return;
    this._gagQueue.shift();

    const centerWorldX = worldX + GAG_LEAD_PX;
    const centerIdx = this.slices.findIndex((s) => s.worldXStart >= centerWorldX);
    if (centerIdx < 0) return;
    const startIdx = Math.max(0, centerIdx - Math.floor(GAG_SLICE_COUNT / 2));
    const group = this.slices.slice(startIdx, startIdx + GAG_SLICE_COUNT);
    if (group.length === 0) return;

    group.forEach((s, i) => {
      s._gagSinkAtMs = nowMs + i * GAG_STAGGER_MS;
    });
    // Recovery is a single synchronized moment for the whole group, snapped
    // to the nearest kick for punch (spec-style crack-birth kick sync).
    const holdEndEstimate = nowMs + (group.length - 1) * GAG_STAGGER_MS + GAG_HOLD_MS;
    const nearestKick = this.conductor
      ? this.conductor.nearestEventMs((e) => e.role === Role.RHYTHM && e.kick, holdEndEstimate, GAG_KICK_SYNC_WINDOW_MS)
      : null;
    const recoverMs = nearestKick ? Math.max(holdEndEstimate, nearestKick.tMs) : holdEndEstimate;
    for (const s of group) s._gagRecoverAtMs = recoverMs;
  }

  update(nowMs, dtSec, worldX, energyCurves) {
    this.justRecovered = false;
    this._nowMs = nowMs;
    const bass = energyCurves ? clamp01(energyCurves.sample(1, nowMs)) : 0;
    this._buzz += (1 - Math.exp(-dtSec / 0.12)) * (bass - this._buzz);
    this._spawnSlicesUpTo(worldX + LOOKAHEAD_PX);
    this._trimBehind(worldX);
    this._maybeTriggerGag(nowMs, worldX);

    for (const s of this.slices) {
      if (!s._initialized) {
        const bandIdx = (s.index + BAND_SHIFT) % NUM_BANDS;
        const e = energyCurves ? clamp01(energyCurves.sample(bandIdx, nowMs)) : 0.3;
        s.baseTarget = -e * RISE_AMPLITUDE_PX; // more energy -> ground rises to meet it
        s._initialized = true;
      }

      let target = s.baseTarget;
      let damping = SPRING_C;

      if (s._gagSinkAtMs !== undefined) {
        if (nowMs >= s._gagRecoverAtMs) {
          target = s.baseTarget;
          if (nowMs < s._gagRecoverAtMs + RECOVER_DURATION_MS) {
            damping = RECOVER_C; // softened briefly -> elastic overshoot on the way back up
            if (!s._recoveredFired) { s._recoveredFired = true; this.justRecovered = true; }
          } else {
            s._gagSinkAtMs = undefined; // gag fully resolved, back to plain band-driven behavior
          }
        } else if (nowMs >= s._gagSinkAtMs) {
          target = GAG_SAG_PX;
        }
      }

      const accel = -SPRING_K * (s.offset - target) - damping * s.vel;
      s.vel += accel * dtSec;
      s.offset += s.vel * dtSec;
    }
  }

  _sliceAt(worldX) {
    // Slices are generated in ascending worldXStart order; linear scan is
    // fine at this count (a couple dozen live slices at once).
    for (let i = this.slices.length - 1; i >= 0; i--) {
      if (this.slices[i].worldXStart <= worldX) return this.slices[i];
    }
    return this.slices[0] || null;
  }

  /** Physics reference: the ground height directly under an arbitrary world-x (used for Midio's own position). */
  heightAt(worldX) {
    const s = this._sliceAt(worldX);
    return this.baseGroundY + (s ? s.offset : 0);
  }

  /** Rendering helper: slice rectangles visible across [worldX, worldX+screenWidth] in screen space.
   * Includes a render-only bass buzz: a 13 Hz vertical shiver, phase-staggered
   * across slices by the golden angle so it travels as a shimmer rather than
   * the whole floor bouncing in lockstep. heightAt() (the physics reference)
   * deliberately does NOT include it -- a 1-2px visual tremble is free, a
   * trembling physics floor is not. */
  visibleBars(worldX, originX, screenWidth) {
    const bars = [];
    const buzzAmp = 2.5 * this._buzz;
    const wt = (this._nowMs / 1000) * 2 * Math.PI * 13;
    for (const s of this.slices) {
      const screenXStart = s.worldXStart - worldX + originX;
      const screenXEnd = screenXStart + this.sliceWidth;
      if (screenXEnd < -20 || screenXStart > screenWidth + 20) continue;
      const buzz = buzzAmp > 0.15 ? buzzAmp * Math.sin(wt + s.index * 2.39996) : 0;
      bars.push({ x: screenXStart, width: this.sliceWidth, y: this.baseGroundY + s.offset + buzz });
    }
    return bars;
  }
}
