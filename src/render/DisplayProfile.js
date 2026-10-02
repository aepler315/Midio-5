// Versioned display preferences. Stage resolution remains in smw:stageRes.
export const DISPLAY_PREFS_KEY = 'smw:display:v1';
export const DEFAULT_DISPLAY_PREFS = Object.freeze({ version: 1, look: 'natural', quality: 'auto', palette: 'range32', dither: .35, scaling: 'fit' });

export function resolveDisplayPrefs({ saved, legacyStagePreset } = {}) {
  let prefs = saved;
  try { if (typeof prefs === 'string') prefs = JSON.parse(prefs); } catch { prefs = null; }
  if (prefs?.version === 1 && ['natural', 'pixel', 'palette'].includes(prefs.look)
      && ['auto', 'economy'].includes(prefs.quality) && ['range32', 'rgb332'].includes(prefs.palette)
      && [0, .35, 1].includes(prefs.dither) && ['fit', 'integer'].includes(prefs.scaling)) {
    return { version: 1, look: prefs.look, quality: prefs.quality, palette: prefs.palette, dither: prefs.dither, scaling: prefs.scaling };
  }
  const defaults = { ...DEFAULT_DISPLAY_PREFS };
  if (legacyStagePreset === '8bit') return { ...defaults, look: 'pixel', quality: 'economy' };
  if (legacyStagePreset === '8bit-intensive') return { ...defaults, look: 'palette', quality: 'economy', palette: 'rgb332', dither: 1 };
  return defaults;
}

export function readDisplayPrefs(storage) {
  try { return resolveDisplayPrefs({ saved: storage?.getItem(DISPLAY_PREFS_KEY), legacyStagePreset: storage?.getItem('smw:stageRes') }); }
  catch { return resolveDisplayPrefs(); }
}
export function writeDisplayPrefs(storage, prefs) {
  try { storage?.setItem(DISPLAY_PREFS_KEY, JSON.stringify(resolveDisplayPrefs({ saved: prefs }))); return !!storage; }
  catch { return false; }
}
export function resolvePresentation(prefs) {
  const p = resolveDisplayPrefs({ saved: prefs });
  const pixelated = p.look !== 'natural';
  return { pixelated, grid: pixelated ? { width: 320, height: 180 } : null,
    paletteId: p.look === 'palette' ? p.palette : 'none', dither: p.dither, quality: p.quality, scaling: p.scaling };
}
