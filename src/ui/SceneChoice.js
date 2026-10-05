// The range and biome a player has asked for, from the title screen or a
// link.
//
// "Auto" (the default) leaves both to the song, as before. A biome keeps
// the whole song in that biome (no travel to others). A range is one of the
// catalog's real-terrain views, unreviewed candidates included; it brings
// its own biome with it, so the ground, sky and palette under the view
// always match it.
//
// A link wins over what is remembered: ?range=<view id> and
// ?biome=<NAME>. ?rangeView=<id> is the older diagnostic spelling and still
// works. Remembered across visits per device; blocked storage just means
// nothing is remembered.

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

// A pilot copy of a view (id ending -coherent) is a side-by-side test of
// an old foreground ledge, not a different place; it stays reachable by
// ?rangeView for review but is kept out of the menu.
const isPilotCopy = (v) => /-coherent$/.test(v.id);

/** Every view a player can pick, candidates included, sorted by name. */
export function pickableViews(catalog, { pilots = false } = {}) {
  return (catalog?.views || []).filter((v) => v?.id && v.biome && (pilots || !isPilotCopy(v)))
    .sort((a, b) => viewLabel(a).localeCompare(viewLabel(b)));
}

/** The menu text for a view. Two views can share a title (a pilot beside
 *  its original), so the label says which one it is. */
export function viewLabel(view, biomeTitle = null) {
  const alt = /-coherent$/.test(view.id) ? ', alternate' : '';
  const note = view.status === 'approved' ? '' : ` (unreviewed${alt})`;
  return `${view.title}${biomeTitle ? ` · ${biomeTitle}` : ''}${note}`;
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
  // The diagnostic spelling also reaches the pilot copies.
  const views = pickableViews(catalog, { pilots: !!q.get('rangeView') && !q.get('range') });
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
 *  bar is a link to it. Drops the older ?rangeView spelling. */
export function searchWithSceneChoice(search, { viewId = null, biome = null } = {}) {
  let q;
  try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { q = new URLSearchParams(); }
  q.delete('rangeView');
  q.delete('range');
  q.delete('biome');
  if (viewId) q.set('range', viewId);
  else if (biome) q.set('biome', biome);
  const s = q.toString();
  return s ? `?${s}` : '';
}
