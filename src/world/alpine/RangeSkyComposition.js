/** One frame's Range-specific upper-sky ownership. Keep faint star depth
 * behind the live ridge while reserving its body for incidental figures. */
export function createRangeSkyComposition(spaceRidge, canvas, { voyageActive = false } = {}) {
  const corridorAt = spaceRidge.corridor(canvas);
  const allowPoint = (x, y) => {
    const { top, bottom } = corridorAt(x);
    return y < top || y > bottom;
  };
  const starBrightnessAt = (x, y) => {
    const { top, bottom } = corridorAt(x);
    const feather = Math.max(1, canvas.height * 0.025);
    const distance = Math.max(top - y, y - bottom, 0);
    const u = Math.min(1, distance / feather);
    return 0.12 + 0.88 * u * u * (3 - 2 * u);
  };
  return {
    allowPoint,
    starBrightnessAt,
    decorativeAlpha: 0.18,
    showWeaver: !voyageActive,
    weaverOptions: { maxFigures: 1, maxRetained: 0, allowPoint },
    celestialShafts: false,
    biomeRays: false,
  };
}

export function rangeMoonRadius(canvasHeight, scale) {
  return Math.min(Math.max(14, canvasHeight * 0.0361) * scale, canvasHeight * 0.07);
}

// ---------------------------------------------------------------------------
// Range v2 sky hierarchy (Task 13). The reference moon is a secondary object
// about 3.5% of the frame width across, textured and partly crossed by cloud;
// the sky holds sparse, low-contrast cloud banks that leave the SpaceRidge
// corridor and the Dancing Ridge their own space.

/** Moon radius under Range v2: ~3.5% of the frame width across. */
export function rangeV2MoonRadius(canvasWidth, approachScale = 1) {
  return canvasWidth * 0.0175 * Math.min(1.25, Math.max(0.85, approachScale));
}

const hash = (i, salt) => {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Lunar maria: a few soft darker basins, fixed on the face (clipped to it). */
export function drawMoonMaria(ctx, cx, cy, R, alpha = 1) {
  const basins = [[-0.28, -0.22, 0.34], [0.12, -0.3, 0.22], [-0.05, 0.1, 0.28], [0.3, 0.18, 0.16], [-0.35, 0.28, 0.14]];
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (const [dx, dy, r] of basins) {
    const g = ctx.createRadialGradient(cx + dx * R, cy + dy * R, 0, cx + dx * R, cy + dy * R, r * R);
    g.addColorStop(0, `rgba(96,104,122,${(0.28 * alpha).toFixed(3)})`);
    g.addColorStop(1, 'rgba(96,104,122,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
  ctx.restore();
}

/**
 * Deterministic cloud banks for a frame: sparse, elongated, drifting slowly
 * in heard time (pure: pause holds, seek reconstructs). Two wisps are
 * anchored to cross the moon when one is given.
 */
export function rangeCloudBanks({ width, height, tSec = 0, seed = 0, moon = null, count = 6 }) {
  const banks = [];
  for (let i = 0; i < count; i++) {
    const speed = 4 + 6 * hash(i, seed + 1); // px per second
    const span = width * 1.6;
    const x = ((hash(i, seed + 2) * span + tSec * speed) % span) - width * 0.3;
    const y = height * (0.06 + 0.3 * hash(i, seed + 3));
    const w = width * (0.12 + 0.16 * hash(i, seed + 4));
    banks.push({ id: `bank${i}`, x, y, w, h: w * (0.1 + 0.06 * hash(i, seed + 5)), alpha: 0.28 + 0.14 * hash(i, seed + 6), puffs: 7 });
  }
  if (moon) {
    for (let k = 0; k < 2; k++) {
      const drift = Math.sin(tSec * 0.05 + k * 2.1) * moon.R * 1.2;
      banks.push({ id: `wisp${k}`, x: moon.x + drift + (k ? -0.4 : 0.5) * moon.R * 3, y: moon.y + (k ? 0.45 : -0.2) * moon.R,
        w: moon.R * (5 + 2 * k), h: moon.R * 0.42, alpha: 0.5 - 0.1 * k, puffs: 5 });
    }
  }
  return banks;
}

/** Paint cloud banks: a dark body with a lit rim toward the light. */
export function drawRangeClouds(ctx, banks, { dark = [52, 60, 78], lit = [196, 176, 168], light = null, allowPoint = null, alpha = 1 } = {}) {
  ctx.save();
  for (const b of banks) {
    const lx = light ? Math.sign(light.x - b.x) : 0, ly = light ? (light.y < b.y ? -1 : 1) : -1;
    for (let p = 0; p < b.puffs; p++) {
      const u = b.puffs === 1 ? 0.5 : p / (b.puffs - 1);
      const px = b.x - b.w / 2 + u * b.w;
      const py = b.y + Math.sin(u * 9 + b.w) * b.h * 0.25;
      if (allowPoint && !allowPoint(px, py)) continue;
      const rx = b.h * (1.3 + 0.9 * Math.sin(u * Math.PI)), ry = b.h * (0.55 + 0.35 * Math.sin(u * Math.PI));
      for (const [col, off, a] of [[lit, 0.2, 0.75], [dark, -0.06, 1]]) {
        const ox = px + lx * rx * off, oy = py + ly * ry * off;
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rx);
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${(b.alpha * a * alpha).toFixed(3)})`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(1, ry / rx);
        ctx.translate(-ox, -oy);
        ctx.beginPath();
        ctx.arc(ox, oy, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}
