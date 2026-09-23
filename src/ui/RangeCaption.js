// The caption that names the real mountain range behind the song.
//
// The Range draws a real skyline (src/world/terrain/), matched to the song
// from a basket of real ranges. This names it once, the way a film names its
// location: the range, the place the view centres on, two quick numbers --
// how much real skyline was sampled and how fast the characters cover it --
// and the credits the data asks for. It fades in a moment after the song
// starts, holds, and goes.
//
// It is drawn on the canvas (Renderer calls drawRangeCaption), not laid over
// it as page text, so recordings and bulk exports carry it too. Its fade
// runs on song time, not page timers, so an export frame at 3s shows exactly
// what live play showed at 3s.

/** The range The Range falls back to when no match loaded in time. */
export const BUNDLED_RANGE = Object.freeze({
  id: 'tetons', name: 'Teton Range', landmark: 'Grand Teton', region: 'Wyoming, USA', source: 'curated',
});

export const CAPTION_DELAY_MS = 1500;
export const CAPTION_FADE_MS = 1200;
export const CAPTION_HOLD_MS = 6500;

const KM_PER_MILE = 1.609344;
const MPS_TO_MPH = 3600 / 1609.344;

/** "21 mi of real skyline sampled · riding at ~340 mph", or '' when neither
 *  number is known. */
export function rangeStatsLine({ lengthKm = NaN, speedMps = NaN } = {}) {
  const parts = [];
  if (lengthKm > 0) parts.push(`${Math.round(lengthKm / KM_PER_MILE)} mi of real skyline sampled`);
  if (speedMps > 0) parts.push(`riding at ~${Math.round((speedMps * MPS_TO_MPH) / 5) * 5} mph`);
  return parts.join(' · ');
}

/**
 * What to show, or null for nothing. Only the alpine world draws real
 * terrain, so every other world gets no caption even when a range was
 * matched (it is matched before the world is chosen).
 */
export function rangeCaptionFor(range, worldKind, stats = {}) {
  if (worldKind !== 'alpine') return null;
  const r = range && range.name ? range : BUNDLED_RANGE;
  const credit = r.source === 'discovered'
    ? 'Real elevation: AWS Terrain Tiles · summit: GeoNames (CC BY 4.0) · range: Wikidata'
    : 'Real elevation: AWS Terrain Tiles';
  return {
    title: r.name,
    place: [r.landmark, r.region].filter(Boolean).join(' · '),
    stats: rangeStatsLine(stats),
    credit,
  };
}

/** Caption opacity at `songMs`: in over CAPTION_FADE_MS after the delay,
 *  hold, then out over the same fade. */
export function captionAlpha(songMs, {
  delayMs = CAPTION_DELAY_MS, fadeMs = CAPTION_FADE_MS, holdMs = CAPTION_HOLD_MS,
} = {}) {
  const t = Number(songMs);
  if (!Number.isFinite(t) || t <= delayMs) return 0;
  const inEnd = delayMs + fadeMs;
  const outStart = inEnd + holdMs;
  if (t < inEnd) return (t - delayMs) / fadeMs;
  if (t <= outStart) return 1;
  return Math.max(0, 1 - (t - outStart) / fadeMs);
}

// Sits above the song-progress strip (ComposerStrip: 72px tall, 10px up).
const BOTTOM_CLEAR = 104;
const LEFT = 24;

/** Draw the caption into a 2D context whose transform maps `stage`
 *  (the nominal stage, in its own units) onto the canvas. */
export function drawRangeCaption(ctx, stage, caption, songMs) {
  if (!caption) return;
  const alpha = captionAlpha(songMs);
  if (!(alpha > 0)) return;
  const lift = (1 - Math.min(1, alpha)) * 6;
  const lines = [
    { text: caption.title, font: '600 30px "Segoe UI", system-ui, -apple-system, sans-serif', color: 'rgba(242, 240, 248, 1)', gap: 0 },
    { text: caption.place, font: '16px "Segoe UI", system-ui, -apple-system, sans-serif', color: 'rgba(242, 240, 248, 0.72)', gap: 8 },
    { text: caption.stats, font: '14px "Segoe UI", system-ui, -apple-system, sans-serif', color: 'rgba(255, 215, 106, 0.85)', gap: 8 },
    { text: caption.credit, font: '11px "Segoe UI", system-ui, -apple-system, sans-serif', color: 'rgba(242, 240, 248, 0.5)', gap: 8 },
  ].filter((l) => l.text);
  const sizes = lines.map((l) => Number(/(\d+)px/.exec(l.font)[1]));
  let y = stage.height - BOTTOM_CLEAR + lift;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 1;
  // Bottom line up, so the block keeps its bottom edge above the strip.
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.font = lines[i].font;
    ctx.fillStyle = lines[i].color;
    ctx.fillText(lines[i].text, LEFT, y);
    y -= sizes[i] + (lines[i].gap || 0);
  }
  ctx.restore();
}
