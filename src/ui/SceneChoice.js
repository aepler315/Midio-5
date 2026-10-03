// The range and biome a player has asked for, from the title screen or a
// link.
//
// "Auto" (the default) leaves both to the song, as before. A biome keeps
// the whole song in that biome (no travel to others). A range is one of the
// catalog's approved scenic views; it brings its own biome with it, so the
// ground, sky and palette under the view always match it.
//
// A link wins over what is remembered: ?range=<view id> and
// ?biome=<NAME>. ?rangeView=<id> is the older diagnostic spelling and still
// works, candidates included. Remembered across visits per device; blocked
// storage just means nothing is remembered.

export const RANGE_CHOICE_KEY = 'smw:sceneRange';
export const BIOME_CHOICE_KEY = 'smw:sceneBiome';
export const AUTO = 'auto';

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read(key, storage) {
  try { return storage?.getItem(key) || null; } catch { return null; }
}

function write(key, value, storage) {
  try {
    if (!value || value === AUTO) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch { /* no storage */ }
}

/** The views a player can pick: approved ones, in catalog order. */
export function pickableViews(catalog) {
  return (catalog?.views || []).filter((v) => v?.status === 'approved' && v.id && v.biome);
}

/**
 * What the player asked for, given what exists now:
 *   { viewId, biome, source }
 * viewId/biome are null for Auto. `source` is 'link', 'remembered' or
 * null. An unknown range or biome counts as Auto rather than starting
 * somewhere nobody picked. A range always carries its own biome.
 *   search: location.search; storage: localStorage-like;
 *   catalog: the scene catalog; biomeNames: biomes a song can be in.
 */
export function resolveSceneChoice({ search = '', storage = defaultStorage(), catalog, biomeNames = [] } = {}) {
  let q;
  try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { q = new URLSearchParams(); }
  const linkRange = q.get('range') || q.get('rangeView');
  const linkBiome = q.get('biome');
  const fromLink = !!(linkRange || linkBiome);
  const rawRange = fromLink ? linkRange : read(RANGE_CHOICE_KEY, storage);
  const rawBiome = fromLink ? linkBiome : read(BIOME_CHOICE_KEY, storage);
  // The diagnostic spelling may name a candidate; the picker's may not.
  const views = q.get('rangeView') && !q.get('range') ? (catalog?.views || []) : pickableViews(catalog);
  const view = rawRange && rawRange !== AUTO ? views.find((v) => v.id === rawRange) || null : null;
  const upper = rawBiome && rawBiome !== AUTO ? String(rawBiome).toUpperCase() : null;
  const biome = view ? view.biome : (upper && biomeNames.includes(upper) ? upper : null);
  const viewId = view ? view.id : null;
  return { viewId, biome, source: viewId || biome ? (fromLink ? 'link' : 'remembered') : null };
}

/** Remember a choice (null or AUTO clears it). */
export function writeSceneChoice({ viewId = null, biome = null } = {}, storage = defaultStorage()) {
  write(RANGE_CHOICE_KEY, viewId, storage);
  write(BIOME_CHOICE_KEY, viewId ? null : biome, storage);
}

/** The page's query string with the choice written into it, so the address
 *  bar is a link to it. A candidate view keeps the diagnostic ?rangeView
 *  spelling, the only one that admits it. */
export function searchWithSceneChoice(search, { viewId = null, biome = null, candidate = false } = {}) {
  let q;
  try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { q = new URLSearchParams(); }
  q.delete('rangeView');
  q.delete('range');
  q.delete('biome');
  if (viewId) q.set(candidate ? 'rangeView' : 'range', viewId);
  else if (biome) q.set('biome', biome);
  const s = q.toString();
  return s ? `?${s}` : '';
}
