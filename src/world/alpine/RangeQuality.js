// Range v2 quality ladder (plan Task 16). PerfGovernor owns the level (0
// best .. 6) and its hysteresis: a rung sheds after ~1 s of sustained
// over-budget frames, returns after 10 clean seconds, and a rung that fails
// again after recovering waits twice as long before the next try. This
// table says what the Range's GPU scene gives up at each level, in order:
// the stable foliage subset first, then fog sampling, then the rock-stage
// pool reflections (Renderer, level 6). Landform structure (terrain meshes
// and their LOD budget), ground contact, performer cores and the musical
// signatures are never touched by the ladder.
import { forestKeepFraction } from './ForestCover.js';
import { MIST_SAMPLES } from './RangeAtmosphere.js';

// Fog samples per pixel by level. Level 5 used to thin the mist's density
// instead, which changed the look without saving any work.
const MIST_STEPS = [MIST_SAMPLES, MIST_SAMPLES, MIST_SAMPLES, 4, 4, 3, 2];

/** What the scene draws at a governor level. */
export function rangeQuality(level = 0) {
  const q = Math.max(0, Math.min(6, level | 0));
  return {
    level: q,
    forestKeep: forestKeepFraction(q),
    mistSteps: MIST_STEPS[q],
    poolReflections: q < 6,
  };
}
