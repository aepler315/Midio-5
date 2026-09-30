// One immutable scenic anchor and radiance snapshot, before any painting.
import { dayNight, celestialXFracFor, celestialYFracFor, horizonFade } from './DayNight.js';
import { celestialApproach } from './CelestialApproach.js';
import { OCEAN_HORIZON_FRAC } from './Ocean.js';
import { clamp01 } from '../utils/math.js';

export function resolveCelestialState({ timeMs, cycleMs, viewport, approach = {}, moonOffset = {},
  nightFill = .35, reducedMotion = false, sunColor = '#fff3df', moonColor = '#c8d8ff',
  sunRadiusPx = 26, moonRadiusPx = 26, radiusCapPx = Infinity }) {
  const dn = dayNight(timeMs, cycleMs), { width, height } = viewport;
  const body = (alt, az, name) => {
    const app = celestialApproach({ orbitX: width * celestialXFracFor(az),
      orbitY: height * celestialYFracFor(alt), horizonY: height * OCEAN_HORIZON_FRAC,
      progress01: approach.progress01 || 0, observerDy: approach.observerDy || 0 });
    const visibility = horizonFade(alt);
    let dx = name === 'moon' && !reducedMotion && visibility > 0 ? moonOffset.dxPx || 0 : 0;
    let dy = name === 'moon' && !reducedMotion && visibility > 0 ? moonOffset.dyPx || 0 : 0;
    const bound = Math.min(1, 6 * height / 720 / (Math.hypot(dx, dy) || 1));
    dx *= bound; dy *= bound;
    return Object.freeze({ xFrac: (app.x + dx) / width, yFrac: (app.y + dy) / height,
      radiusFrac: Math.min(radiusCapPx, (name === 'sun' ? sunRadiusPx : moonRadiusPx) * app.scale) / width,
      scale: app.scale, altitude01: alt, visibility, directGain: (name === 'sun' ? 1.6 : .25) * visibility,
      colorHex: name === 'sun' ? sunColor : moonColor });
  };
  const sun = body(dn.sunAlt,dn.sunAz01,'sun'), moon = body(dn.moonAlt,dn.moonAz01,'moon');
  return Object.freeze({ sun, moon, activeBody: sun.visibility > 0 ? 'sun' : moon.visibility > 0 ? 'moon' : null,
    night01: dn.night, dawn01: dn.dawnAlpha, dusk01: dn.duskAlpha,
    ambientMultiplier: 1 + (clamp01(nightFill) - 1) * dn.night });
}
