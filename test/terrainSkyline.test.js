import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apparentAngle, scanCorridor, smoothBaseline, pointAlong,
} from '../src/world/terrain/SkylineScan.js';
import {
  buildProfile, profileUnits, sampleProfile, profileChunks, profileFromDem,
} from '../src/world/terrain/TerrainProfile.js';
import { resolveStripHeights, layoutRidgeYs } from '../src/world/SilhouetteGenerator.js';

// A straight crest at x = 0, camera 80 km to the east. A lower ridge stands
// between them. The traced crest is the tall mountain. The skyline is not.
function frontDem() {
  const cellM = 1000;
  const width = 81;
  const height = 21;
  const elev = new Float64Array(width * height);
  elev.fill(1500);
  elev[10 * width + 0] = 4000;   // crest, 80 km from the camera
  elev[10 * width + 55] = 3000;  // nearer ridge, 25 km from the camera
  return {
    elev, width, height, cellM, originX: 0, originY: 0,
  };
}

const GUIDE = [{ x: 0, y: 0 }, { x: 0, y: 20000 }];

function scanFront(extra = {}) {
  return scanCorridor(frontDem(), GUIDE, {
    distanceM: 80000,
    cameraElevM: 1800,
    side: -1,
    spacingM: 5000,
    pastM: 2000,
    smoothWindowM: 0,
    ...extra,
  });
}

test('the skyline is the highest angle, not the highest elevation', () => {
  const scan = scanFront();
  const atSummit = 2; // y = 10000
  assert.equal(scan.crestElevM[atSummit], 4000);
  assert.equal(scan.skylineElevM[atSummit], 3000);
  assert.ok(scan.skylineDistM[atSummit] < 40000, 'the winning terrain is the nearer ridge');
  assert.ok(scan.skylineAngle[atSummit] > apparentAngle(4000, 1800, 80000, false));
});

test('isolating the guide drops the foreground ridge out of the skyline', () => {
  const scan = scanFront({ isolateBandM: 8000 });
  assert.equal(scan.skylineElevM[2], 4000);
  assert.ok(scan.skylineDistM[2] > 70000);
});

test('curvature lowers a distant crest and does not move the camera onto the summits', () => {
  const far = apparentAngle(4000, 1800, 80_000, false);
  const curved = apparentAngle(4000, 1800, 80_000, true);
  assert.ok(curved < far);
  const plain = scanFront();
  const withCurve = scanFront({ curvature: true });
  assert.ok(withCurve.skylineAngle[2] < plain.skylineAngle[2]);
});

test('a zigzag guide is not stretched to its own arc length', () => {
  // 22 km of walking, about 2 km of net progress. The camera follows the
  // broad direction, so the profile is the short one.
  const guide = [
    { x: 0, y: 0 },
    { x: 0, y: 10000 },
    { x: 1000, y: 10000 },
    { x: 1000, y: 0 },
    { x: 2000, y: 0 },
  ];
  const dem = frontDem();
  const scan = scanCorridor(dem, guide, {
    distanceM: 5000,
    cameraElevM: 1800,
    side: -1,
    spacingM: 500,
    pastM: 1000,
    smoothWindowM: 30000,
  });
  assert.ok(scan.guideLengthM > 20000);
  assert.ok(scan.baselineLengthM < scan.guideLengthM * 0.75,
    `baseline ${scan.baselineLengthM} should be well under the walked crest ${scan.guideLengthM}`);
});

test('profile scale is the whole range, and a window does not tile or re-stretch', () => {
  const profile = profileFromDem(frontDem(), GUIDE, {
    distanceM: 80000,
    cameraElevM: 1800,
    side: -1,
    spacingM: 5000,
    pastM: 2000,
    smoothWindowM: 0,
  }, { name: 'front' });
  const units = profileUnits(profile);
  const summit = units[2];
  assert.ok(summit > 0.5, 'the occluding ridge is the tall angle in this corridor');
  // A chunk that is only the quiet end of the range stays quiet.
  const quiet = sampleProfile(profile, 0, 1, profile.spacingM);
  assert.ok(quiet[0] < summit);
  const past = sampleProfile(profile, profile.spacingM * 100, 2, profile.spacingM);
  const end = sampleProfile(profile, profile.spacingM * (units.length - 1), 1, profile.spacingM);
  assert.equal(past[0], end[0]);
  assert.equal(past[1], end[0]);
});

test('consecutive chunks overlap on the same source samples', () => {
  const starts = profileChunks(11, { chunk: 4, overlap: 1 });
  assert.deepEqual(starts, [0, 3, 6, 7]);
  assert.equal(starts[starts.length - 1] + 4, 11);
});

test('a real profile is not blended into a tile, and a foothill is not stretched', () => {
  const src = [0.05, 0.2, 0.55, 0.9];
  const heights = resolveStripHeights(4, src, () => {
    throw new Error('procedural skyline must not run for a supplied profile');
  });
  assert.ok(Math.abs(heights[3] - 0.9) < 1e-6);
  assert.ok(heights[3] > heights[0]);

  // Both of these overflow the strip, so the procedural refit pulls each
  // tile's own tallest sample to the same headroom line — a foothill
  // window becomes as tall as the summit window. The terrain path keeps
  // the 0.12 ratio from the whole profile.
  const opts = { height: 320, footY: 176, hanging: false, amplitude: 5, profile: 'alpine' };
  const hill = new Float32Array([0.12, 0.12, 0.12, 0.12]);
  const peak = new Float32Array([1, 1, 1, 1]);
  const hillKept = layoutRidgeYs(hill, { ...opts, preserveScale: true });
  const peakKept = layoutRidgeYs(peak, { ...opts, preserveScale: true });
  const hillThrow = 176 - hillKept.ridgeYs[0];
  const peakThrow = 176 - peakKept.ridgeYs[0];
  assert.ok(Math.abs(hillThrow / peakThrow - 0.12) < 1e-6);
  const hillFit = layoutRidgeYs(hill, { ...opts, preserveScale: false });
  const peakFit = layoutRidgeYs(peak, { ...opts, preserveScale: false });
  assert.ok(Math.abs(hillFit.ridgeYs[0] - peakFit.ridgeYs[0]) < 1);
});

test('smoothBaseline of a straight guide stays on that guide', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 10000 }];
  const smooth = smoothBaseline(pts, 4000);
  for (const p of smooth) assert.ok(Math.abs(p.x) < 1, `left the guide: ${p.x}`);
  const mid = pointAlong(pts, 5000);
  assert.equal(mid.y, 5000);
});

test('buildProfile rejects a scan with no visible terrain', () => {
  const dem = frontDem();
  dem.elev.fill(dem.noData ?? NaN);
  dem.noData = NaN;
  // NaN-filled: sampleDem treats non-finite as missing. Scan angles are NaN.
  assert.throws(() => buildProfile(scanCorridor(dem, GUIDE, {
    distanceM: 80000, cameraElevM: 1800, side: -1, spacingM: 5000, pastM: 2000, smoothWindowM: 0,
  })));
});
