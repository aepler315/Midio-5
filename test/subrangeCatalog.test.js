import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceKm } from '../tools/lib/rangeDiscovery.mjs';
import {
  acceptSubranges, applyCenterOverride, applySummitOverride, claimSummits, inNortheastWashington, isNamedRange,
  parseGeonamesFeature, separateViewpoints, shouldBuild,
} from '../tools/lib/subrangeCatalog.mjs';

const row = (fields) => {
  const f = Array(19).fill('');
  Object.entries(fields).forEach(([i, v]) => { f[i] = String(v); });
  return f.join('\t');
};

test('parseGeonamesFeature keeps a named range and a summit', () => {
  const kettle = parseGeonamesFeature(row({
    0: 1, 1: 'Kettle River Range', 4: 48.83, 5: -118.42, 6: 'T', 7: 'MTS', 8: 'US', 10: 'WA', 15: 2169,
  }));
  assert.equal(kettle.name, 'Kettle River Range');
  assert.equal(kettle.code, 'MTS');
  assert.equal(kettle.elevM, 2169);
  assert.equal(parseGeonamesFeature(row({ 1: 'Seattle', 4: 1, 5: 1, 6: 'P', 7: 'PPL' })), null);
});

test('a range name is a range, a meadow coded MTS is not, a Selkirk ridge is', () => {
  assert.equal(isNamedRange('Huckleberry Range'), true);
  assert.equal(isNamedRange('Chewelah Mountains'), true);
  assert.equal(isNamedRange('Sierra Nevada'), true);
  assert.equal(isNamedRange('The Seven Devils'), true);
  assert.equal(isNamedRange('Sophys Meadows'), false);
  assert.equal(isNamedRange('Kruger Mountain'), false);
  assert.equal(isNamedRange('Crowell Ridge'), false);
  assert.equal(isNamedRange('Crowell Ridge', { ridge: true }), true);
  assert.equal(isNamedRange('Gypsy Ridge', { ridge: true }), true);
});

test('northeast Washington is the Selkirk and Kettle country, not the Olympics', () => {
  assert.equal(inNortheastWashington(48.95, -117.15), true, 'Gypsy Peak');
  assert.equal(inNortheastWashington(48.83, -118.42), true, 'Kettle River Range');
  assert.equal(inNortheastWashington(48.50, -116.75), true, 'Selkirk GNIS point');
  assert.equal(inNortheastWashington(47.87, -123.67), false, 'Olympics');
  assert.equal(inNortheastWashington(48.11, -121.11), false, 'Glacier Peak');
});

test('the Selkirk view moves onto Gypsy Peak', () => {
  const moved = applyCenterOverride({ name: 'Selkirk Mountains', lat: 48.5, lon: -116.75, elevM: 1625, admin1: 'ID' });
  assert.equal(moved.landmark, 'Gypsy Peak');
  assert.equal(moved.admin1, 'WA');
  assert.ok(moved.lat > 48.9 && moved.lon < -117);
  const kettle = applyCenterOverride({ name: 'Kettle River Range', lat: 48.8, lon: -118.4, admin1: 'WA' });
  assert.equal(kettle.lat, 48.8);
  assert.equal(kettle.landmark, null);
});

test('acceptSubranges keeps distinct ranges and drops names the basket already has', () => {
  const at = (name, lat, lon, elevM = 2000, kind = 'range') => ({ name, lat, lon, elevM, kind });
  const picks = acceptSubranges([
    at('Cascade Range', 46.8, -121.7, 4000),
    at('Kettle River Range', 48.83, -118.42, 2169),
    at('Taylor Ridge', 48.806, -118.378, 1800, 'ridge'),
    at('Huckleberry Range', 48.47, -118.05, 1500),
    at('Black Hills', 46.99, -123.14, 700),
    at('Black Hills', 47.03, -122.97, 650),
    at('Selkirk Mountains', 48.946, -117.152, 2226),
    at('Gypsy Ridge', 48.955, -117.156, 2148, 'ridge'),
    at('Crowell Ridge', 48.891, -117.201, 2038, 'ridge'),
  ], {
    taken: [
      { name: 'Cascade Range', lat: 46.85, lon: -121.76 },
      { name: 'Selkirk Mountains', lat: 50.95, lon: -117.43 },
    ],
  });
  assert.deepEqual(picks.map((p) => p.name), [
    'Kettle River Range', 'Huckleberry Range', 'Black Hills', 'Selkirk Mountains', 'Crowell Ridge',
  ]);
});

test('a summit already claimed stays with the name that sits on it', () => {
  const gypsy = { name: 'Gypsy Peak', lat: 48.946, lon: -117.152, elevM: 2226, geonameId: 1 };
  const [selkirk, lead] = claimSummits([
    {
      name: 'Selkirk Mountains',
      origin: { lat: 48.946, lon: -117.152, elevM: 2226, geonameId: 9 },
      summit: gypsy,
    },
    {
      name: 'Lead King Hills',
      origin: { lat: 48.947, lon: -117.349, elevM: 1600, geonameId: 8 },
      summit: gypsy,
    },
  ]);
  assert.equal(selkirk.summit.name, 'Gypsy Peak');
  assert.equal(lead.summit.name, 'Lead King Hills');
  assert.ok(lead.lon < -117.3);
  const copper = { name: 'Copper Butte', lat: 48.702, lon: -118.465, elevM: 2171, geonameId: 2 };
  const [kettle, spur] = claimSummits([
    {
      name: 'Kettle River Range', kind: 'range',
      origin: { lat: 48.833, lon: -118.418, elevM: 1700, geonameId: 3 },
      summit: copper,
    },
    {
      name: 'Taylor Ridge', kind: 'ridge',
      origin: copper,
      summit: copper,
    },
  ]);
  assert.equal(kettle.summit.name, 'Copper Butte', 'the range keeps its high point');
  assert.equal(spur.summit.name, 'Taylor Ridge');
});

test('a flat hill is not built, including in northeast Washington', () => {
  assert.equal(shouldBuild({ priority: 'northeast-washington', probeReliefM: 193 }), false);
  assert.equal(shouldBuild({ priority: 'northeast-washington', probeReliefM: 350 }), true);
  assert.equal(shouldBuild({ priority: 'west', probeReliefM: 340 }), false);
  assert.equal(shouldBuild({ priority: 'west', probeReliefM: 400 }), true);
  assert.equal(shouldBuild({ priority: 'west', probeReliefM: NaN }), false);
  assert.equal(shouldBuild({ probeReliefM: 900, absorbedBy: 'Bitterroot Range' }), false);
});

test('Lost River moves onto Borah Peak; a California Sawtooth does not', () => {
  const lost = applySummitOverride({ name: 'Lost River Range', lat: 43.99, lon: -113.6, elevM: 3483, admin1: 'ID' });
  assert.equal(lost.landmark, 'Borah Peak');
  assert.equal(lost.summitLocked, true);
  assert.ok(lost.lat > 44.1 && lost.elevM > 3800);
  const california = applySummitOverride({ name: 'Sawtooth Range', lat: 33, lon: -116, admin1: 'CA' });
  assert.equal(california.summitLocked, undefined);
});

test('two names on one viewpoint do not both keep it', () => {
  const hill = { name: 'Pot Mountain', lat: 46.73547, lon: -115.40819, elevM: 2149, geonameId: 2 };
  const [bitter, moose] = claimSummits([
    {
      name: 'Bitterroot Range', kind: 'range',
      origin: { lat: 46.73547, lon: -115.40764, elevM: 2172, geonameId: 1 },
      summit: { name: 'Bitterroot Range', lat: 46.73547, lon: -115.40764, elevM: 2172, geonameId: 1 },
    },
    {
      name: 'Moose Mountains', kind: 'range',
      origin: hill,
      summit: hill,
    },
  ]);
  assert.equal(bitter.absorbedBy, null);
  assert.equal(moose.absorbedBy, 'Bitterroot Range');
});

test('a lower summit within a kilometre is not a second skyline', () => {
  const entries = [
    { id: 'bitterroot-range', build: true, summit: { lat: 46.735, lon: -115.408, elevM: 2172 } },
    { id: 'moose-mountains', build: true, summit: { lat: 46.736, lon: -115.409, elevM: 2149 } },
    { id: 'kettle-river-range', build: true, summit: { lat: 48.702, lon: -118.465, elevM: 2171 } },
  ];
  separateViewpoints(entries);
  assert.equal(entries[1].build, false);
  assert.equal(entries[1].absorbedBy, 'bitterroot-range');
  assert.equal(entries[2].build, true);
});

test('the catalog keeps one viewpoint, the relief floor, and the right Idaho crests', () => {
  const { ranges } = JSON.parse(readFileSync(new URL('../data/terrain/subranges.json', import.meta.url), 'utf8'));
  const built = ranges.filter((r) => r.build);
  for (const r of ranges) {
    if (r.skyline === 'rejected') continue;
    assert.equal(r.build, shouldBuild(r), r.id);
  }
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const d = distanceKm(built[i].summit, built[j].summit);
      assert.ok(d >= 1, `${built[i].id} and ${built[j].id} are ${d.toFixed(2)} km apart`);
    }
  }
  const lost = ranges.find((r) => r.id === 'lost-river-range');
  assert.equal(lost.landmark, 'Borah Peak');
  assert.ok(lost.summit.elevM > 3800);
  const sawtooth = ranges.find((r) => r.id === 'sawtooth-range-idaho-usa');
  assert.equal(sawtooth?.landmark, 'Thompson Peak');
  assert.equal(sawtooth.build, true);
  assert.equal(ranges.find((r) => r.id === 'lance-hills').build, false);
  assert.equal(ranges.find((r) => r.id === 'pot-hills').build, false);
  assert.equal(ranges.find((r) => r.id === 'moose-mountains').build, false);
});
