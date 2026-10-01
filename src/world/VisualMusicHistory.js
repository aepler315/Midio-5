// Immutable indexes reconstruct decorative state without dispatching old cues.
import { Role } from '../core/NoteEvent.js';
function countAt(events, timeMs) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tMs <= timeMs) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function lastAt(events, timeMs) { return events[countAt(events, timeMs) - 1] ?? null; }
const kickAmp = (kick) => (kick ? .4 + .6 * kick.vel : 0);
export class VisualMusicHistory {
  constructor(timeline = []) {
    this.rhythm = Object.freeze(timeline.filter(e => e.role === Role.RHYTHM)
      .map(e => Object.freeze({ ...e })).sort((a, b) => a.tMs - b.tMs));
    this.kicks = this.rhythm.filter(e => e.kick);
  }
  /** The latest kick, and the one before it (whose effects may still be
   *  travelling when the next lands). */
  sample(timeMs) {
    const n = countAt(this.kicks, timeMs);
    const kick = this.kicks[n - 1] ?? null, prev = this.kicks[n - 2] ?? null;
    return { rhythm: lastAt(this.rhythm, timeMs), kickMs: kick?.tMs ?? -Infinity, kickAmp: kickAmp(kick),
      prevKickMs: prev?.tMs ?? -Infinity, prevKickAmp: kickAmp(prev) };
  }
}
