import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scatterSky, sunIrradiance, shaftEnvelope, horizonWarmth } from '../src/world/Scattering.js';

test('sunIrradiance is brightest at zenith, a remainder at the horizon, and a twilight tail below it', () => {
  const zenith = sunIrradiance(1);
  const horizon = sunIrradiance(0);
  const twilight = sunIrradiance(-0.05);
  const night = sunIrradiance(-0.4);
  assert.ok(zenith > horizon && horizon > twilight && twilight > night,
    `expected zenith>horizon>twilight>night, got ${zenith}, ${horizon}, ${twilight}, ${night}`);
  assert.ok(horizon > 0.3, 'the air is still lit at the moment of sunset');
  assert.equal(sunIrradiance(-1), 0);
  assert.equal(sunIrradiance(undefined), 0);
});

test('shafts exist only when the sun is up and low — not at zenith, not below the horizon', () => {
  assert.equal(shaftEnvelope(-0.1), 0);
  assert.equal(shaftEnvelope(0), 0);
  assert.equal(shaftEnvelope(1), 0);
  const rise = shaftEnvelope(0.12);
  const noon = shaftEnvelope(0.9);
  assert.ok(rise > 0.4, `low sun should throw shafts, got ${rise}`);
  assert.equal(noon, 0);
  assert.ok(shaftEnvelope(0.12) > shaftEnvelope(0.40), 'shafts fade as the sun climbs');
});

test('noon zenith is bluer than the horizon (Rayleigh)', () => {
  const f = scatterSky({ sunAlt: 1, night: 0, hazeMul: 1 });
  const zenithBR = f.zenith.b / Math.max(1, f.zenith.r);
  const horizonBR = f.horizon.b / Math.max(1, f.horizon.r);
  assert.ok(zenithBR > horizonBR,
    `zenith b/r ${zenithBR.toFixed(2)} should exceed horizon b/r ${horizonBR.toFixed(2)}`);
  assert.ok(f.zenith.b > f.zenith.r, 'noon zenith is actually blue, not grey');
});

test('a low sun warms the horizon (long-path Rayleigh leftover)', () => {
  const noon = scatterSky({ sunAlt: 1, night: 0 });
  const dusk = scatterSky({ sunAlt: 0.06, night: 0 });
  assert.ok(horizonWarmth(dusk) > horizonWarmth(noon),
    `dusk warmth ${horizonWarmth(dusk).toFixed(2)} should exceed noon ${horizonWarmth(noon).toFixed(2)}`);
  assert.ok(dusk.horizon.r > dusk.horizon.b, 'dusk horizon is warm, not blue');
  assert.ok(dusk.mieRadiusFrac > noon.mieRadiusFrac, 'Mie corona grows as the sun nears the horizon');
  assert.ok(dusk.sunGlowA > noon.sunGlowA * 0.6, 'directional glow stays present at dusk');
});

test('twilight still lights the air after the sun has set', () => {
  const twilight = scatterSky({ sunAlt: -0.04, night: 0.4 });
  const midnight = scatterSky({ sunAlt: -1, night: 1 });
  assert.ok(twilight.horizon.a > midnight.horizon.a,
    'civil twilight horizon should out-glow midnight');
  assert.ok(twilight.irr > 0.1, 'the air is still irradiated just below the horizon');
  assert.equal(midnight.irr, 0);
  assert.ok(midnight.zenith.a < twilight.zenith.a, 'midnight Rayleigh is the residual airglow');
});

test('night keeps scattering faint so stars stay the event', () => {
  const day = scatterSky({ sunAlt: 0.8, night: 0 });
  const night = scatterSky({ sunAlt: -0.5, night: 1 });
  assert.ok(night.zenith.a < day.zenith.a * 0.55,
    `night zenith alpha ${night.zenith.a} should be well under day ${day.zenith.a}`);
  assert.ok(night.sunGlowA < 0.08, 'no daylight corona at night');
  assert.equal(night.shaft, 0);
});

test('city night leans the horizon toward sodium Mie (light pollution), alpine night does not', () => {
  const alpine = scatterSky({ sunAlt: -0.4, night: 1, city: false });
  const city = scatterSky({ sunAlt: -0.4, night: 1, city: true });
  assert.ok(city.horizon.r > alpine.horizon.r, 'city horizon is warmer');
  assert.ok(city.horizon.a > alpine.horizon.a, 'city limb is denser (aerosols + streetlight)');
  assert.ok(city.mie.b >= city.mie.r * 0.7, 'city Mie around the moon stays cool, not sunset-orange');
});

test('a thicker haze dial lifts overlay alpha without blowing out', () => {
  const crisp = scatterSky({ sunAlt: 0.5, hazeMul: 0.3 });
  const baked = scatterSky({ sunAlt: 0.5, hazeMul: 1.6 });
  assert.ok(baked.horizon.a > crisp.horizon.a);
  assert.ok(baked.limb.a <= 1 && baked.mie.a <= 1 && baked.zenith.a <= 1);
  for (const f of [crisp, baked]) {
    for (const c of [f.zenith, f.horizon, f.mie, f.limb]) {
      assert.ok(c.r >= 0 && c.r <= 255 && c.g >= 0 && c.g <= 255 && c.b >= 0 && c.b <= 255);
      assert.ok(c.a >= 0 && c.a <= 1);
    }
  }
});

test('scatterSky is deterministic and finite for the full altitude range', () => {
  for (const alt of [-1, -0.2, -0.04, 0, 0.1, 0.5, 1]) {
    const a = scatterSky({ sunAlt: alt, night: alt < 0 ? 1 : 0, hazeMul: 1 });
    const b = scatterSky({ sunAlt: alt, night: alt < 0 ? 1 : 0, hazeMul: 1 });
    assert.deepEqual(a, b);
    assert.ok(Number.isFinite(a.irr) && Number.isFinite(a.mieRadiusFrac));
  }
});
