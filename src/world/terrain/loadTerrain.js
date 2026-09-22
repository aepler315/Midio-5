// The Range's far ridge. Built by tools/build-terrain-profile.mjs from
// USGS 3DEP. One layer: this view of the Tetons did not contain a second
// ridge far enough away to be its own group.
import raw from './tetonsFrontData.js';
import { profilesFromJSON } from './TerrainProfile.js';

let cached = null;

export function alpineTerrainProfiles() {
  if (!cached) cached = profilesFromJSON(raw);
  return cached;
}
