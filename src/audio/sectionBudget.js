// Section pacing: how many boundaries a song of a given length is allowed,
// and how close together they may sit.
//
// Shared because two independent detectors have to agree on it -- the
// chroma+timbre SSM (StructureAnalyzer, driven from AudioAdapter) and the
// band-energy novelty fallback (BiomeManager._buildSchedule). They used to
// keep separate numbers: the analyzer silently applied its own defaults
// because AudioAdapter never passed anything, so the two could pace a song
// differently depending only on which one happened to win. One home, one set
// of numbers, no drift.
import { clamp } from '../utils/math.js';

/** No two section boundaries closer together than this. */
export const MIN_SECTION_CUT_GAP_MS = 11000;
/** Roughly one section per this much song, before clamping. */
export const SECTION_CUT_BUDGET_MS = 24000;
export const MIN_SECTION_CUTS = 3, MAX_SECTION_CUTS = 12;

/** How many cuts a song this long may express. Scales with length instead of
 *  a flat count, so a five-minute song can hold close to a section every 24s
 *  while a ninety-second one stays coarse. */
export function sectionCutBudget(durationMs) {
  return clamp(Math.round(durationMs / SECTION_CUT_BUDGET_MS), MIN_SECTION_CUTS, MAX_SECTION_CUTS);
}
