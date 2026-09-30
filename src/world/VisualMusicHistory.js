// Immutable indexes reconstruct decorative state without dispatching old cues.
import { Role } from '../core/NoteEvent.js';
function lastAt(events, timeMs) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tMs <= timeMs) lo = mid + 1; else hi = mid;
  }
  return events[lo - 1] ?? null;
}
export class VisualMusicHistory {
  constructor(timeline = []) {
    this.rhythm = timeline.filter(e => e.role === Role.RHYTHM);
    this.kicks = this.rhythm.filter(e => e.kick);
  }
  sample(timeMs) {
    const kick = lastAt(this.kicks, timeMs);
    return { rhythm: lastAt(this.rhythm, timeMs), kickMs: kick?.tMs ?? -Infinity,
      kickAmp: kick ? .4 + .6 * kick.vel : 0 };
  }
}
