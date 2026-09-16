/**
 * Build the stable gallery shown after a song is analyzed. A generated world
 * is an interpretation of one registered world, so it replaces that world's
 * play target instead of creating a second, competing card.
 */
import { describeWorldResponse } from './WorldPreview.js';

export function buildWorldChoices(worlds, customWorld = null, features = null, extras = {}) {
  return worlds.map((world) => ({
    worldId: world.id,
    playWorldId: customWorld?.baseId === world.id ? customWorld.id : world.id,
    name: world.name,
    tagline: world.tagline,
    kind: world.kind,
    description: describeWorldResponse(world.kind, features || {}, extras),
    manualOnly: !!world.manualOnly,
  }));
}

/** Keyboard order for the gallery: left/right wrap, no ranking. */
export function moveChoiceIndex(index, delta, count) {
  if (!count) return 0;
  return ((index + delta) % count + count) % count;
}
