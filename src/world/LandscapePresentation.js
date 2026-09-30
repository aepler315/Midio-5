/** Explicit shared listening policy; legacy reveal URLs have the same default. */
export function resolveLandscapePresentation({ worldId = 'range', stageWidth = 1280, stageHeight = 720, groundY = null } = {}) {
  const width = Number.isFinite(stageWidth) && stageWidth > 0 ? stageWidth : 1280;
  const height = Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : 720;
  return Object.freeze({ mode: 'landscape', cast: false, incidentalActors: false,
    worldId, stageAnchor: Object.freeze({ originX: width * (220 / 1280),
      groundY: Number.isFinite(groundY) ? groundY : height * (625 / 720) }) });
}
