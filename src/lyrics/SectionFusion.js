// Fuses the novelty-curve section schedule BiomeManager already builds
// (_buildSchedule's spectral-change cuts) with the structural sections read
// from lyrics (LyricStructure.labelBlocks). When lyrics are synced, lyric
// boundaries snap to the beat grid and merge with/insert into the novelty
// cuts; when lyrics are plain text only, novelty boundaries are the only
// truth and lyric labels are order-matched onto them at low confidence.
// Absent lyricSections is always a no-op: the exact input array comes back,
// so every existing BiomeManager code path is unaffected when there's no
// lyric data at all.
import { clamp01 } from '../utils/math.js';

function nearestBarMs(barGrid, tMs) {
  if (!barGrid || barGrid.length === 0) return tMs;
  let best = barGrid[0].ms, bestDist = Math.abs(tMs - best);
  for (let i = 1; i < barGrid.length; i++) {
    const d = Math.abs(tMs - barGrid[i].ms);
    if (d < bestDist) { bestDist = d; best = barGrid[i].ms; }
  }
  return best;
}

function barWidthMs(barGrid) {
  if (!barGrid || barGrid.length < 2) return 2000;
  let sum = 0, n = 0;
  for (let i = 1; i < barGrid.length; i++) { sum += barGrid[i].ms - barGrid[i - 1].ms; n++; }
  return n > 0 ? sum / n : 2000;
}

/** Section (from `sections`, an array with .startMs/.endMs) whose range
 *  contains `tMs`, or the closest one if none contains it exactly (covers
 *  small rounding gaps at the fused boundaries). */
function sectionAt(sections, tMs) {
  for (const s of sections) if (tMs >= s.startMs && tMs < s.endMs) return s;
  let best = sections[0], bestDist = Infinity;
  for (const s of sections) {
    const mid = (s.startMs + s.endMs) / 2;
    const d = Math.abs(tMs - mid);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

const DEFAULT_LYRIC = { kind: null, lyricIntensity: 0.4, lyricValence: 0, lyricConfidence: 0 };

function withLyric(base, lyricSection) {
  return {
    ...base,
    kind: lyricSection ? lyricSection.kind : DEFAULT_LYRIC.kind,
    lyricIntensity: lyricSection ? lyricSection.intensity : DEFAULT_LYRIC.lyricIntensity,
    lyricValence: lyricSection ? lyricSection.valence : DEFAULT_LYRIC.lyricValence,
    lyricConfidence: lyricSection ? lyricSection.confidence : DEFAULT_LYRIC.lyricConfidence,
  };
}

/** Fuses `noveltySections` ({startMs,endMs,transition,barMs,label,profile,
 *  hueBias, ...}) with `lyricSections` (LyricStructure.labelBlocks output).
 *  Returns a new sections array; `noveltySections` itself is never
 *  mutated. Passing an empty/absent `lyricSections` returns the exact same
 *  array reference (a true no-op) -- callers can always fuse
 *  unconditionally. */
export function fuseSections(noveltySections, lyricSections, barGrid, durationMs) {
  if (!Array.isArray(lyricSections) || lyricSections.length === 0) return noveltySections;
  if (!Array.isArray(noveltySections) || noveltySections.length === 0) return noveltySections;

  const synced = lyricSections[0].startMs !== undefined;

  if (!synced) {
    // Plain lyrics carry no timing at all -- boundaries stay exactly the
    // novelty ones (never moved), labels/emotion order-matched on at low
    // confidence. Extra lyric blocks beyond the novelty section count are
    // simply unused; novelty sections beyond the lyric block count keep no
    // lyric label.
    return noveltySections.map((s, i) => withLyric(s, lyricSections[i] || null));
  }

  const barW = barWidthMs(barGrid);
  const boundarySet = new Map(); // snapped ms -> true (Map keeps insertion-agnostic uniqueness via key)
  for (const s of noveltySections) boundarySet.set(s.startMs, true);
  for (const ls of lyricSections) {
    if (ls.startMs <= 0) continue; // the song start is always a boundary already
    const snapped = nearestBarMs(barGrid, ls.startMs);
    const alreadyClose = [...boundarySet.keys()].some((b) => Math.abs(b - snapped) <= barW);
    if (!alreadyClose) boundarySet.set(snapped, true);
  }

  const boundaries = [...boundarySet.keys()].sort((a, b) => a - b);
  if (boundaries[0] > 0) boundaries.unshift(0);

  return boundaries.map((startMs, i) => {
    const endMs = i + 1 < boundaries.length ? boundaries[i + 1] : durationMs;
    const noveltyMatch = sectionAt(noveltySections, (startMs + Math.min(endMs, startMs + 1)) / 2);
    const lyricMatch = sectionAt(lyricSections, (startMs + endMs) / 2);
    return withLyric(
      { startMs, endMs, transition: noveltyMatch.transition, barMs: noveltyMatch.barMs, label: noveltyMatch.label, profile: noveltyMatch.profile, hueBias: noveltyMatch.hueBias },
      lyricMatch,
    );
  });
}

/** Additive intensity bias (-1..1-ish, but callers should clamp/scale) for
 *  VibeDirector.epicBias, keyed by structural kind -- the "epic bridge"
 *  payoff: a bridge always gets a strong lift regardless of its own lyric
 *  vocabulary, a chorus gets a moderate one, instrumental/outro settle. */
export function epicBiasForKind(kind, lyricIntensity) {
  const base = { chorus: 0.25, bridge: 0.45, instrumental: 0.15, intro: -0.1, outro: -0.15, verse: 0 }[kind] ?? 0;
  return clamp01(0.5 + base + 0.3 * (lyricIntensity - 0.4)) * 2 - 1;
}
