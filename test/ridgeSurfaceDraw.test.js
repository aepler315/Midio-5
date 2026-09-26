import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSurfacePoint, surfaceCopies, drawRidgeSurface, resolveFacetTone, selectVisibleSurface } from '../src/world/alpine/RidgeSurfaceDraw.js';

test('a centered or absent key light does not erase matte face differences', () => {
  const palette = {
    base: '#5c6255', faceLight: '#788071', faceShade: '#343d3a',
    gully: '#26332f', intrinsicContrast: 1,
  };
  const a = { normal: { x: -.6, y: -.2, z: .77 }, intrinsicTone: .55 };
  const b = { normal: { x: .6, y: -.2, z: .77 }, intrinsicTone: -.55 };
  for (const lightDirection of [null, { x: 0, y: -1, z: .3, intensity: 1 }]) {
    const left = resolveFacetTone({ facet: a, palette, lightDirection });
    const right = resolveFacetTone({ facet: b, palette, lightDirection });
    assert.notEqual(left.baseColor, right.baseColor);
    assert.ok(Number.isFinite(left.directionalAlpha));
    assert.ok(Number.isFinite(right.directionalAlpha));
    if (lightDirection === null) {
      assert.equal(left.directionalAlpha, 0);
      assert.equal(right.directionalAlpha, 0);
    }
  }
});

test('structural faces stay distributed across a handoff', () => {
  const facet = (id, sx) => ({
    id, structural: true, importance: 1,
    vertices: [{ sx, depth01: 0 }, { sx: sx + 20, depth01: 0.5 }, { sx: sx + 10, depth01: 0.8 }],
  });
  const left = [facet('L1', 20), facet('L2', 40), facet('L3', 60), facet('L4', 80)];
  const right = [facet('R1', 900)];
  const surface = { facets: [...left, ...right], gullies: [], stands: [] };
  const picked = selectVisibleSurface({
    sides: [{ sideId: 'A', surface, seamWeight: 1 }],
    sourceWindows: { A: { min: 0, max: 1000 } },
    budget: { facetsPerLayer: 6, gulliesPerLayer: 0, standsPerLayer: 0 },
  });
  assert.ok(picked.facets.some((item) => item.id === 'R1'));
  const pair = {
    sides: [
      { sideId: 'A', surface, seamWeight: 0.49 },
      { sideId: 'B', surface: { ...surface, facets: [facet('B1', 100)] }, seamWeight: 0.51 },
    ],
    sourceWindows: { A: { min: 0, max: 1000 }, B: { min: 0, max: 1000 } },
    budget: { facetsPerLayer: 6, gulliesPerLayer: 0, standsPerLayer: 0 },
  };
  const ids = [];
  for (let step = 1; step <= 99; step++) {
    pair.sides[0].seamWeight = step / 100;
    pair.sides[1].seamWeight = 1 - step / 100;
    const next = selectVisibleSurface(pair);
    assert.ok(next.facets.length <= 6);
    ids.push(next.facets.map((item) => `${item.sideId}:${item.id}`).join(','));
  }
  assert.equal(new Set(ids).size, 1);
});

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
