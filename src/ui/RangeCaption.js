// The caption that names the real mountain range behind the song.
//
// The Range draws a real skyline (src/world/terrain/), matched to the song
// from a basket of real ranges. This names it once, the way a film names its
// location: a cast list of the three ranges, back ridge to front, two quick
// numbers -- how much real skyline was sampled and how fast the characters
// cover it -- and the credits the data asks for. It fades in a moment after the song
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

const RIDGE_LABELS = [['far', 'BACK'], ['mid', 'MIDDLE'], ['near', 'FRONT']];

/** "British Columbia" from "British Columbia, Canada": the country is
 *  noise in a cast list that is all North America. */
export function shortRegion(region) {
  return typeof region === 'string' ? region.split(',')[0].trim() : '';
}

/**
 * The cast list, back ridge first: [{ label, name, region }]. Only ridges
 * that stand on a real range are listed; a lone range (the bundled Tetons)
 * is listed without a label, since there is nothing to tell it apart from.
 */
export function castRows(ranges) {
  const rows = RIDGE_LABELS
    .filter(([ridge]) => ranges?.[ridge]?.name)
    .map(([ridge, label]) => ({ label, name: ranges[ridge].name, region: shortRegion(ranges[ridge].region) }));
  if (rows.length === 1) rows[0].label = '';
  return rows;
}

/**
 * What to show, or null for nothing. Only the alpine world draws real
 * terrain, so every other world gets no caption even when a range was
 * matched (it is matched before the world is chosen). `range` is the back
 * range; `ridges` ({ mid, near }) the ranges standing in front of it.
 */
export function rangeCaptionFor(range, worldKind, stats = {}, ridges = {}) {
  if (worldKind !== 'alpine') return null;
  const far = range && range.name ? range : BUNDLED_RANGE;
  const cast = far === BUNDLED_RANGE ? { far } : { far, mid: ridges?.mid, near: ridges?.near };
  const credit = Object.values(cast).some((x) => x?.source === 'discovered')
    ? 'Elevation: AWS Terrain Tiles · summits: GeoNames (CC BY 4.0) · ranges: Wikidata'
    : 'Elevation: AWS Terrain Tiles';
  return { rows: castRows(cast), stats: rangeStatsLine(stats), credit };
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
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const ROW_H = 27;
const LABEL_W = 70; // the widest label, MIDDLE, at 11px with tracking
const REGION_GAP = 18;

/** Draw the caption into a 2D context whose transform maps `stage`
 *  (the nominal stage, in its own units) onto the canvas, in the bottom
 *  right corner. Laid out bottom up, so the block keeps its bottom edge above the progress strip:
 *
 *    BACK     Lillooet Ranges      British Columbia
 *    MIDDLE   Sierra Nevada        California
 *    FRONT    Livingston Range     Montana
 *    116 mi of real skyline sampled · riding at ~600 mph
 *    Elevation: AWS Terrain Tiles · ...
 */
export function drawRangeCaption(ctx, stage, caption, songMs) {
  if (!caption) return;
  const alpha = captionAlpha(songMs);
  if (!(alpha > 0)) return;
  const lift = (1 - Math.min(1, alpha)) * 6;
  const rows = caption.rows || [];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 1;
  const nameFont = `600 20px ${FONT}`;
  const regionFont = `15px ${FONT}`;
  const statsFont = `14px ${FONT}`;
  const creditFont = `11px ${FONT}`;
  const labelled = rows.some((r) => r.label);
  const width = (str, font) => { ctx.font = font; return str ? ctx.measureText(str).width : 0; };
  const nameW = rows.reduce((w, r) => Math.max(w, width(r.name, nameFont)), 0);
  const regionW = rows.reduce((w, r) => Math.max(w, width(r.region, regionFont)), 0);
  const blockW = Math.max(
    (labelled ? LABEL_W : 0) + nameW + (regionW > 0 ? REGION_GAP + regionW : 0),
    width(caption.stats, statsFont), width(caption.credit, creditFont));
  // Bottom right: the characters run along the left third of the frame, and
  // a block there sat under them. A stage too narrow to fit it (portrait)
  // keeps it at the left edge.
  const left = Math.max(LEFT, stage.width - LEFT - blockW);
  let y = stage.height - BOTTOM_CLEAR + lift;
  const text = (str, x, font, color) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  };
  if (caption.credit) {
    text(caption.credit, left, creditFont, 'rgba(242, 240, 248, 0.5)');
    y -= caption.stats ? 20 : ROW_H + 4;
  }
  if (caption.stats) {
    text(caption.stats, left, statsFont, 'rgba(255, 215, 106, 0.88)');
    y -= ROW_H + 4;
  }
  const nameX = left + (labelled ? LABEL_W : 0);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.label) {
      if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
      text(r.label, left, `700 11px ${FONT}`, 'rgba(242, 240, 248, 0.55)');
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
    text(r.name, nameX, nameFont, 'rgba(242, 240, 248, 1)');
    if (r.region) text(r.region, nameX + nameW + REGION_GAP, regionFont, 'rgba(242, 240, 248, 0.62)');
    y -= ROW_H;
  }
  ctx.restore();
}
