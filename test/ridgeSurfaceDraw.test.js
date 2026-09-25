import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSurfacePoint, surfaceCopies, drawRidgeSurface } from '../src/world/alpine/RidgeSurfaceDraw.js';

test('features project onto the exact live crest and local foot', () => {
  const geom = { bottomY: 300, dh: 200, pts: [
    { stripX: 0, x: 10, y: 80, dy: 0 }, { stripX: 100, x: 110, y: 120, dy: 0 },
  ] };
  assert.deepEqual(projectSurfacePoint({ sx: 50, depth01: 0 }, { geom, stripWidth: 100, terrain: true }), { x: 60, y: 100 });
  assert.deepEqual(projectSurfacePoint({ sx: 50, depth01: 1 }, { geom, stripWidth: 100, terrain: true }), { x: 60, y: 300 });
  assert.equal(projectSurfacePoint({ sx: -1, depth01: .5 }, { geom, stripWidth: 100, terrain: true }), null);
  assert.deepEqual(surfaceCopies(2048, 100, 700, true), [0]);
  assert.ok(surfaceCopies(2048, 100, 700, false).length >= 1);
});

test('late source-window cover paints when earlier strip features are off screen', () => {
  const painted = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, fill() {}, stroke() {}, ellipse(x) { painted.push(x); } };
  const surface = { width: 8192, facets: [], gullies: [], stands: [
    { sx: 100, depth01: .3, widthPx: 30, heightPx: 12 },
    { sx: 7100, depth01: .3, widthPx: 30, heightPx: 12 },
  ] };
  const geom = { bottomY: 300, pts: [
    { stripX: 7000, x: 0, y: 100 }, { stripX: 7200, x: 200, y: 110 },
  ] };
  drawRidgeSurface(ctx, { surface, geom, terrain: true, policy: { canopy: .9 },
    budget: { facetsPerLayer: 6, gulliesPerLayer: 0, standsPerLayer: 1 }, alpha: 1 });
  assert.equal(painted.length, 1);
  assert.equal(painted[0], 100);
});

test('face illumination follows screen-space celestial position smoothly', () => {
  const render = x => {
    const colors = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, fill() { colors.push(this.fillStyle); }, stroke() {} };
    const surface = { width: 200, facets: [{ normalX: .8, vertices: [
      { sx: 40, depth01: 0 }, { sx: 100, depth01: .6 }, { sx: 160, depth01: .4 },
    ] }], gullies: [], stands: [] };
    const geom = { bottomY: 300, pts: [
      { stripX: 0, x: 0, y: 100 }, { stripX: 200, x: 200, y: 100 },
    ] };
    drawRidgeSurface(ctx, { surface, geom, terrain: true, budget: {
      facetsPerLayer: 6, gulliesPerLayer: 0, standsPerLayer: 0 }, light: { x, intensity: 1 } });
    return colors[0];
  };
  assert.notEqual(render(20), render(180));
  assert.notEqual(render(180), render(200), 'sun movement should not saturate at ordinary screen x');
});
