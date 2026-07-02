// Dispatches the unified NoteEvent timeline to subscribed systems as the
// audio clock advances (spec §0.2 rule 2, §6.1). Observer/EventBus pattern —
// systems never touch the timeline directly.
import { sortNoteEvents } from './NoteEvent.js';

export class Conductor {
  constructor() {
    /** @type {import('./NoteEvent.js').NoteEvent[]} */
    this.timeline = [];
    this.barGrid = [];
    this.durationMs = 0;
    this.cursor = 0;
    /** @type {Map<string, Set<Function>>} role -> listeners, plus '*' for all */
    this.listeners = new Map();
    this.barCursor = 0;
    this.barListeners = new Set();
  }

  load({ timeline, barGrid, durationMs }) {
    this.timeline = sortNoteEvents([...timeline]);
    this.barGrid = barGrid || [];
    this.durationMs = durationMs || 0;
    this.cursor = 0;
    this.barCursor = 0;
  }

  /** Subscribe to events of a given role, or '*' for everything. Returns unsubscribe fn. */
  on(role, fn) {
    if (!this.listeners.has(role)) this.listeners.set(role, new Set());
    this.listeners.get(role).add(fn);
    return () => this.listeners.get(role)?.delete(fn);
  }

  onBar(fn) {
    this.barListeners.add(fn);
    return () => this.barListeners.delete(fn);
  }

  /** Dispatch every event with tMs <= nowMs that hasn't fired yet. Never skips. */
  dispatchUpTo(nowMs) {
    while (this.cursor < this.timeline.length && this.timeline[this.cursor].tMs <= nowMs) {
      const evt = this.timeline[this.cursor++];
      this._emit(evt.role, evt);
      this._emit('*', evt);
    }
    while (this.barCursor < this.barGrid.length && this.barGrid[this.barCursor].ms <= nowMs) {
      const bar = this.barGrid[this.barCursor++];
      for (const fn of this.barListeners) fn(bar);
    }
  }

  _emit(key, evt) {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const fn of set) fn(evt);
  }

  /** Look-ahead peek without consuming — used by TelegraphScanner. */
  peekWindow(nowMs, windowMs) {
    const end = nowMs + windowMs;
    const out = [];
    for (let i = this.cursor; i < this.timeline.length && this.timeline[i].tMs <= end; i++) {
      if (this.timeline[i].tMs >= nowMs) out.push(this.timeline[i]);
    }
    return out;
  }

  reset() {
    this.cursor = 0;
    this.barCursor = 0;
  }
}
