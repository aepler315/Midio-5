// The caption that names the real mountain range behind the song.
//
// The Range draws a real skyline (src/world/terrain/), matched to the song
// from a basket of real ranges. Nothing on screen said which one, so the
// grounding was invisible. This names it once, the way a film names its
// location: it fades in a moment after the song starts, holds, and goes.
// Purely visual -- pointer-events:none, and never shown in a bulk export.
//
// It also carries the credits the data asks for: the elevation comes from
// AWS Terrain Tiles, and a discovered range's summit from GeoNames, whose
// licence (CC BY 4.0) requires attribution where the data is used.

/** The range The Range falls back to when no match loaded in time. */
export const BUNDLED_RANGE = Object.freeze({
  id: 'tetons', name: 'Teton Range', region: 'Wyoming, USA', source: 'curated',
});

export const CAPTION_DELAY_MS = 1500;
export const CAPTION_HOLD_MS = 6500;

/**
 * What to show, or null for nothing. Only the alpine world draws real
 * terrain, so every other world gets no caption even when a range was
 * matched (it is matched before the world is chosen).
 */
export function rangeCaptionFor(range, worldKind) {
  if (worldKind !== 'alpine') return null;
  const r = range && range.name ? range : BUNDLED_RANGE;
  const credit = r.source === 'discovered'
    ? 'Real elevation: AWS Terrain Tiles · summit: GeoNames (CC BY 4.0)'
    : 'Real elevation: AWS Terrain Tiles';
  return { title: r.name, place: r.region || '', credit };
}

export class RangeCaption {
  /** `el` holds three children with data-part="title|place|credit". The
   *  timers are injectable so tests need no real clock. The defaults are
   *  wrapped: the browser's setTimeout called as this object's method
   *  throws "Illegal invocation", which aborted starting the song. */
  constructor(el, {
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
  } = {}) {
    this.el = el;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timers = [];
  }

  show(caption, { delayMs = CAPTION_DELAY_MS, holdMs = CAPTION_HOLD_MS } = {}) {
    this.hide();
    if (!this.el || !caption) return;
    for (const part of ['title', 'place', 'credit']) {
      const node = this.el.querySelector(`[data-part="${part}"]`);
      if (node) node.textContent = caption[part] || '';
    }
    this.el.classList.remove('hidden');
    this.timers.push(this.setTimer(() => this.el.classList.add('shown'), delayMs));
    this.timers.push(this.setTimer(() => this.el.classList.remove('shown'), delayMs + holdMs));
  }

  hide() {
    for (const t of this.timers) this.clearTimer(t);
    this.timers = [];
    this.el?.classList.remove('shown');
  }
}
