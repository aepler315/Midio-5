// Musical terracing planner — maps phrase accents to tiered hazards and
// decorative props under Midio's predicted jump arcs (spec §2.2.3).
import { clamp } from '../utils/math.js';
import { extractAccents, Strength } from './PhraseAccentExtractor.js';
import {
  HEIGHT_TIERS, quantizeHeight, coveredWindowsTiered, snapToWindow,
} from './JumpPlanner.js';

const PROP_WIDTH = 28;

function barEnergyNorm(tMs, barGrid, energyCurves) {
  if (!energyCurves || !barGrid.length) return 0.5;
  let barIdx = 0;
  for (let i = 0; i < barGrid.length; i++) {
    if (barGrid[i].ms <= tMs) barIdx = i;
    else break;
  }
  const barStart = barGrid[barIdx].ms;
  const barEnd = barGrid[barIdx + 1]?.ms ?? barStart + 2000;
  const mid = (barStart + barEnd) / 2;
  return clamp(energyCurves.globalEnergy(mid), 0, 1);
}

function bandMidEnergy(energyCurves, tMs) {
  if (!energyCurves) return 0.5;
  return (energyCurves.sample(3, tMs) + energyCurves.sample(4, tMs)) / 2;
}

function accentHeight(accent, energyCurves) {
  const mid = bandMidEnergy(energyCurves, accent.tMs);
  const mix = clamp(0.5 * accent.vel + 0.5 * mid, 0, 1);
  if (accent.strength === Strength.STRONG) {
    return quantizeHeight(HEIGHT_TIERS[1] + (HEIGHT_TIERS[2] - HEIGHT_TIERS[1]) * mix);
  }
  return quantizeHeight(HEIGHT_TIERS[0] + (HEIGHT_TIERS[1] - HEIGHT_TIERS[0]) * mix);
}

/**
 * Plan terrace candidates from musical accents.
 *
 * @returns {Array<{tMs:number, height:number, width:number, kind:string, colliding:boolean}>}
 */
export function planTerraces({
  timeline,
  barGrid = [],
  kicks,
  energyCurves = null,
  obstacleDensity = 1,
  jumpHeight = 1,
  beatPeriodMs = 500,
  rand,
}) {
  const accents = extractAccents(timeline, barGrid);
  const tiered = coveredWindowsTiered(kicks, { jumpHeight });
  const windowsByHeight = new Map(tiered.map((t) => [t.height, t.windows]));
  const minGap = Math.max(0.75 * beatPeriodMs, 360);

  const candidates = [];
  let lastCollidingMs = -Infinity;

  for (const accent of accents) {
    const height = accent.strength === Strength.WEAK
      ? HEIGHT_TIERS[0]
      : accentHeight(accent, energyCurves);

    if (accent.strength === Strength.WEAK) {
      candidates.push({
        tMs: accent.tMs,
        height,
        width: PROP_WIDTH,
        kind: 'prop',
        colliding: false,
      });
      continue;
    }

    const density = barEnergyNorm(accent.tMs, barGrid, energyCurves) * obstacleDensity;
    if (rand() > density) continue;

    const windows = windowsByHeight.get(height) ?? [];
    const snap = snapToWindow(accent.tMs, windows, rand, { bias: 'apex' });
    if (!snap) continue;
    if (snap.placeMs - lastCollidingMs < minGap) continue;

    candidates.push({
      tMs: snap.placeMs,
      height,
      width: PROP_WIDTH,
      kind: accent.strength === Strength.STRONG ? 'terrace' : 'block',
      colliding: true,
    });
    lastCollidingMs = snap.placeMs;
  }

  candidates.sort((a, b) => a.tMs - b.tMs);
  return candidates;
}