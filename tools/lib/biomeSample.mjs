// How a range is turned into one biome plus the biomes around it.
//
// The bounding box is a stamp centred on the summit, so most of it is valley,
// basin, or ocean. A vote over the whole stamp lets that floor outvote the
// crest (the Inyos become shrub steppe, the Manzanos become plateau). The
// crest is the inner part of the stamp. The rest is what surrounds it, and
// it is kept, not thrown away. `share` is the winner's fraction of the
// samples that actually landed in an ecoregion, so water does not dilute it.

/** @param {{biome: string, ecoregion: string}|null|undefined} hit */
export function sampleKey(hit) {
  return hit && hit.biome && hit.ecoregion ? `${hit.biome}|${hit.ecoregion}` : null;
}

/** Ranked [key, count] of the samples that hit an ecoregion. */
export function tallySamples(hits) {
  const votes = new Map();
  let classified = 0;
  for (const hit of hits) {
    const key = sampleKey(hit);
    if (!key) continue;
    classified += 1;
    votes.set(key, (votes.get(key) || 0) + 1);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { classified, ranked };
}

function splitKey(key) {
  const bar = key.indexOf('|');
  return { biome: key.slice(0, bar), ecoregion: key.slice(bar + 1) };
}

/**
 * `summit` is the ecoregion under the summit itself. It wins, because the
 * stamp is centred there: a sky island is pine-oak even when eight of the
 * nine crest samples are the desert around the peak. `share` is then how
 * much of the crest window agrees with that summit. With no summit hit
 * (open water, a gap in the map) the crest majority is used, then the ring.
 * `surrounding` is every other ecoregion in the outer ring.
 */
export function classifySamples({ summit = null, crest = [], around = [] } = {}, { minCrest = 3, keep = 4 } = {}) {
  const crestTally = tallySamples(crest);
  const aroundTally = tallySamples(around);
  const summitKey = sampleKey(summit);
  let winner;
  let share;
  if (summitKey) {
    winner = splitKey(summitKey);
    const agreed = crestTally.ranked.find(([key]) => key === summitKey);
    const denom = crestTally.classified || 1;
    share = +((agreed ? agreed[1] : 1) / denom).toFixed(2);
  } else {
    const use = crestTally.classified >= minCrest ? crestTally : aroundTally;
    if (!use.ranked.length) return null;
    winner = splitKey(use.ranked[0][0]);
    share = +(use.ranked[0][1] / use.classified).toFixed(2);
  }
  const ring = aroundTally.classified ? aroundTally : crestTally;
  const surrounding = ring.ranked
    .filter(([key]) => key !== `${winner.biome}|${winner.ecoregion}`)
    .slice(0, keep)
    .map(([key, n]) => ({ ...splitKey(key), share: +(n / ring.classified).toFixed(2) }));
  return { ...winner, share, surrounding };
}

/** Inner cells of a square grid (the crest) and the ring around them.
 *  The crest is the middle ~40% of the stamp, where the summit is. */
export function crestRingCells(grid) {
  const span = Math.max(1, Math.round(grid * 0.43));
  const lo = Math.floor((grid - span) / 2);
  const hi = lo + span;
  const crest = [];
  const around = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const inner = i >= lo && i < hi && j >= lo && j < hi;
      (inner ? crest : around).push([i, j]);
    }
  }
  return { crest, around };
}
