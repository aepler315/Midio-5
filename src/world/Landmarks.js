// Landmark geometry baked into the parallax silhouettes: an L-system
// engine plus biome-specific painters, drawn once into the L4/L5
// strip canvases at generation time -- infinite per-song variety at zero
// per-frame cost. This is what turns a palette into a place: JADE grows
// trees, ARCTIC crystals, SAKURA torii, CYBER lattice masts, VOID monoliths,
// EMBER spires, TWILIGHT menhirs, SOLAR obelisks, ABYSS chimneys, DUNE arches,
// CORAL fans, LUMEN mushrooms, AURUM sheaves, NEBULA floating isles.
import { mulberry32 } from '../utils/math.js';
import { ridgeYAt } from './SilhouetteGenerator.js';

/** Classic parallel-rewrite L-system expansion. */
export function expandLSystem(axiom, rules, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) next += rules[ch] ?? ch;
    s = next;
  }
  return s;
}

/**
 * Interpret an L-system string as turtle graphics, returning line
 * segments instead of drawing -- pure and unit-testable. Understands
 * F (draw forward), + / - (turn), [ / ] (push/pop state). Depth is the
 * bracket nesting level, for stroke-width tapering.
 */
export function turtleSegments(program, {
  stepLen = 8, angleDeg = 22.5, startX = 0, startY = 0, startAngleDeg = -90, stepDecay = 1,
} = {}) {
  const segments = [];
  const stack = [];
  let x = startX, y = startY, ang = (startAngleDeg * Math.PI) / 180, len = stepLen, depth = 0;
  const turn = (angleDeg * Math.PI) / 180;
  for (const ch of program) {
    if (ch === 'F') {
      const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
      segments.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      x = nx; y = ny;
    } else if (ch === '+') ang += turn;
    else if (ch === '-') ang -= turn;
    else if (ch === '[') { stack.push({ x, y, ang, len, depth }); depth++; len *= stepDecay; }
    else if (ch === ']') { ({ x, y, ang, len, depth } = stack.pop()); }
  }
  return segments;
}

// --- Painters: (ctx, x, rootY, scale, rand, color) -> void, silhouette-filled ---

function paintTree(iters, angle) {
  return (ctx, x, rootY, scale, rand, color) => {
    const program = expandLSystem('X', { X: 'F-[[X]+X]+F[+FX]-X', F: 'FF' }, iters);
    const segs = turtleSegments(program, {
      stepLen: 2.4 * scale, angleDeg: angle + (rand() * 6 - 3),
      startX: x, startY: rootY, startAngleDeg: -90 + (rand() * 10 - 5),
    });
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (const s of segs) {
      ctx.lineWidth = Math.max(0.9, (4.5 - s.depth) * 0.6 * scale);
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
  };
}

function paintCrystals(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const w = (4 + rand() * 5) * scale;
    const h = (30 + rand() * 55) * scale;
    const tilt = (rand() * 2 - 1) * 0.45;
    const cx = x + (i - n / 2) * 9 * scale;
    ctx.save();
    ctx.translate(cx, rootY);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(-w * 0.55, -h);
    ctx.lineTo(0, -h - w * 2.2); // the tip facet
    ctx.lineTo(w * 0.55, -h);
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function paintTorii(ctx, x, rootY, scale, rand, color) {
  const H = (62 + rand() * 16) * scale, span = 50 * scale, pw = 6 * scale;
  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(x, rootY);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * span / 2 - pw / 2, 0);
    ctx.lineTo(side * span / 2 + pw / 2, 0);
    ctx.lineTo(side * span / 2 * 0.9 + pw / 2, -H);
    ctx.lineTo(side * span / 2 * 0.9 - pw / 2, -H);
    ctx.closePath();
    ctx.fill();
  }
  // Upper lintel, gently upswept at the ends; plain tie-beam below it.
  ctx.beginPath();
  ctx.moveTo(-span / 2 - 15 * scale, -H - 2 * scale);
  ctx.quadraticCurveTo(0, -H - 12 * scale, span / 2 + 15 * scale, -H - 2 * scale);
  ctx.lineTo(span / 2 + 13 * scale, -H + 5 * scale);
  ctx.quadraticCurveTo(0, -H - 4 * scale, -span / 2 - 13 * scale, -H + 5 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-span / 2 - 4 * scale, -H + 13 * scale, span + 8 * scale, 5 * scale);
  ctx.restore();
}

function paintLatticeTower(ctx, x, rootY, scale, rand, color) {
  const H = (120 + rand() * 45) * scale;
  const halfBase = 20 * scale, halfTop = 4 * scale;
  const panels = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7 * scale;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(x + side * halfBase, rootY);
    ctx.lineTo(x + side * halfTop, rootY - H);
  }
  for (let i = 0; i < panels; i++) {
    const t0 = i / panels, t1 = (i + 1) / panels;
    const w0 = halfBase + (halfTop - halfBase) * t0, w1 = halfBase + (halfTop - halfBase) * t1;
    const y0 = rootY - H * t0, y1 = rootY - H * t1;
    ctx.moveTo(x - w0, y0); ctx.lineTo(x + w1, y1);
    ctx.moveTo(x + w0, y0); ctx.lineTo(x - w1, y1);
  }
  ctx.moveTo(x, rootY - H);
  ctx.lineTo(x, rootY - H - 18 * scale); // antenna
  ctx.stroke();
}

function paintMonoliths(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const w = (13 + rand() * 9) * scale, h = (55 + rand() * 55) * scale;
    const floatOff = i === n - 1 ? -(18 + rand() * 30) * scale : 0; // the last one levitates
    ctx.save();
    ctx.translate(x + (i - n / 2) * 30 * scale, rootY + floatOff);
    ctx.rotate((rand() * 2 - 1) * 0.14);
    ctx.fillRect(-w / 2, -h, w, h);
    ctx.restore();
  }
}

function paintSpires(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const H = (55 + rand() * 60) * scale, w = (14 + rand() * 8) * scale;
    const cx = x + (i - n / 2) * 26 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - w, rootY);
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const side = k % 2 === 0 ? 1 : -1;
      ctx.lineTo(cx + side * w * (1 - t) * (0.6 + rand() * 0.5), rootY - H * t);
    }
    ctx.lineTo(cx, rootY - H);
    ctx.lineTo(cx + w, rootY);
    ctx.closePath();
    ctx.fill();
  }
}

function paintMenhirs(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const w = (7 + rand() * 5) * scale, h = (16 + rand() * 18) * scale;
    ctx.save();
    ctx.translate(x + (i - n / 2) * 15 * scale, rootY);
    ctx.rotate((rand() * 2 - 1) * 0.1);
    ctx.fillRect(-w / 2, -h, w, h);
    ctx.restore();
  }
}

function paintRuinTower(ctx, x, rootY, scale, rand, color) {
  const H = (75 + rand() * 25) * scale, wB = 15 * scale, wT = 11 * scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - wB, rootY);
  ctx.lineTo(x - wT, rootY - H);
  // Broken crenellated top: three teeth, one shattered short.
  const teeth = [1, 0.45 + rand() * 0.3, 1];
  for (let i = 0; i < 3; i++) {
    const tx0 = x - wT + (i / 3) * 2 * wT, tx1 = x - wT + ((i + 0.6) / 3) * 2 * wT;
    ctx.lineTo(tx0, rootY - H - 7 * scale * teeth[i]);
    ctx.lineTo(tx1, rootY - H - 7 * scale * teeth[i]);
    ctx.lineTo(tx1, rootY - H);
  }
  ctx.lineTo(x + wT, rootY - H);
  ctx.lineTo(x + wB, rootY);
  ctx.closePath();
  ctx.fill();
}

function paintReeds(ctx, x, rootY, scale, rand, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const n = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const h = (18 + rand() * 22) * scale;
    const cx = x + (i - n / 2) * 4 * scale;
    const lean = (rand() * 2 - 1) * 6 * scale;
    ctx.lineWidth = Math.max(0.8, 1.4 * scale);
    ctx.beginPath();
    ctx.moveTo(cx, rootY);
    ctx.quadraticCurveTo(cx + lean * 0.5, rootY - h * 0.6, cx + lean, rootY - h);
    ctx.stroke();
  }
}

function paintObelisks(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    const H = (90 + rand() * 30) * scale, wB = 6 * scale, wT = 3.6 * scale;
    const cx = x + side * 22 * scale;
    ctx.beginPath();
    ctx.moveTo(cx - wB, rootY);
    ctx.lineTo(cx - wT, rootY - H);
    ctx.lineTo(cx, rootY - H - 9 * scale); // pyramidion
    ctx.lineTo(cx + wT, rootY - H);
    ctx.lineTo(cx + wB, rootY);
    ctx.closePath();
    ctx.fill();
  }
}

/** Hydrothermal chimneys / black smokers for ABYSS — stacked irregular stacks. */
function paintChimneys(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const H = (50 + rand() * 70) * scale;
    const wB = (8 + rand() * 7) * scale;
    const wT = wB * (0.45 + rand() * 0.25);
    const cx = x + (i - (n - 1) / 2) * 22 * scale;
    const lean = (rand() * 2 - 1) * 0.12;
    ctx.save();
    ctx.translate(cx, rootY);
    ctx.rotate(lean);
    // Main stack body, slightly waisted mid-height.
    ctx.beginPath();
    ctx.moveTo(-wB, 0);
    ctx.lineTo(-wB * 0.85, -H * 0.45);
    ctx.lineTo(-wT, -H);
    ctx.lineTo(wT, -H);
    ctx.lineTo(wB * 0.85, -H * 0.45);
    ctx.lineTo(wB, 0);
    ctx.closePath();
    ctx.fill();
    // Flared vent lip + a short mineral plume silhouette above.
    const lip = wT * 1.55;
    ctx.beginPath();
    ctx.moveTo(-lip, -H);
    ctx.lineTo(-wT * 0.7, -H - 6 * scale);
    ctx.lineTo(wT * 0.7, -H - 6 * scale);
    ctx.lineTo(lip, -H);
    ctx.closePath();
    ctx.fill();
    const plumeH = (10 + rand() * 18) * scale;
    ctx.beginPath();
    ctx.moveTo(-wT * 0.35, -H - 5 * scale);
    ctx.quadraticCurveTo(-wT * 0.9, -H - plumeH * 0.55, -wT * 0.2, -H - plumeH);
    ctx.quadraticCurveTo(0, -H - plumeH * 0.7, wT * 0.2, -H - plumeH);
    ctx.quadraticCurveTo(wT * 0.9, -H - plumeH * 0.55, wT * 0.35, -H - 5 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Desert sandstone arch for DUNE. */
function paintArch(ctx, x, rootY, scale, rand, color) {
  const H = (55 + rand() * 40) * scale;
  const span = (36 + rand() * 20) * scale;
  const thick = (10 + rand() * 6) * scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  // Outer horseshoe
  ctx.moveTo(x - span, rootY);
  ctx.lineTo(x - span - thick * 0.2, rootY - H * 0.55);
  ctx.quadraticCurveTo(x, rootY - H - thick, x + span + thick * 0.2, rootY - H * 0.55);
  ctx.lineTo(x + span, rootY);
  ctx.lineTo(x + span - thick, rootY);
  ctx.lineTo(x + span - thick * 0.85, rootY - H * 0.5);
  ctx.quadraticCurveTo(x, rootY - H + thick * 0.6, x - span + thick * 0.85, rootY - H * 0.5);
  ctx.lineTo(x - span + thick, rootY);
  ctx.closePath();
  ctx.fill();
}

/** Branching coral fan for CORAL. */
function paintCoralFan(ctx, x, rootY, scale, rand, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const branches = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < branches; i++) {
    const ang = -Math.PI / 2 + (i - (branches - 1) / 2) * 0.28 + (rand() * 0.12 - 0.06);
    const len = (28 + rand() * 36) * scale;
    ctx.lineWidth = Math.max(1.2, (3.2 - i * 0.15) * scale);
    ctx.beginPath();
    ctx.moveTo(x, rootY);
    const mx = x + Math.cos(ang) * len * 0.55 + (rand() * 2 - 1) * 4 * scale;
    const my = rootY + Math.sin(ang) * len * 0.55;
    const ex = x + Math.cos(ang) * len;
    const ey = rootY + Math.sin(ang) * len;
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
    // Tip knobs
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ex, ey, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Cluster of mushroom caps for LUMEN. */
function paintMushrooms(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const stemH = (14 + rand() * 28) * scale;
    const stemW = (2.5 + rand() * 2) * scale;
    const capR = (8 + rand() * 12) * scale;
    const cx = x + (i - (n - 1) / 2) * 16 * scale;
    // Stem
    ctx.fillRect(cx - stemW / 2, rootY - stemH, stemW, stemH);
    // Cap (half-ellipse dome)
    ctx.beginPath();
    ctx.ellipse(cx, rootY - stemH, capR, capR * 0.55, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
}

/** Harvest sheaves / grain stacks for AURUM. */
function paintSheaves(ctx, x, rootY, scale, rand, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const bundles = 3 + Math.floor(rand() * 2);
  for (let b = 0; b < bundles; b++) {
    const bx = x + (b - (bundles - 1) / 2) * 14 * scale;
    const stalks = 7 + Math.floor(rand() * 4);
    for (let i = 0; i < stalks; i++) {
      const lean = (i - stalks / 2) * 0.12 + (rand() * 0.08 - 0.04);
      const h = (22 + rand() * 18) * scale;
      ctx.lineWidth = Math.max(0.8, 1.3 * scale);
      ctx.beginPath();
      ctx.moveTo(bx, rootY);
      ctx.quadraticCurveTo(bx + lean * h * 0.4, rootY - h * 0.55, bx + Math.sin(lean) * h * 0.35, rootY - h);
      ctx.stroke();
    }
    // Binding band
    ctx.lineWidth = 1.6 * scale;
    ctx.beginPath();
    ctx.moveTo(bx - 5 * scale, rootY - 12 * scale);
    ctx.lineTo(bx + 5 * scale, rootY - 12 * scale);
    ctx.stroke();
  }
}

/** Floating rock isles for NEBULA. */
function paintFloatIsles(ctx, x, rootY, scale, rand, color) {
  ctx.fillStyle = color;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const floatY = -(20 + rand() * 50) * scale;
    const w = (18 + rand() * 22) * scale;
    const h = (8 + rand() * 10) * scale;
    const cx = x + (i - (n - 1) / 2) * 36 * scale;
    ctx.save();
    ctx.translate(cx, rootY + floatY);
    ctx.rotate((rand() * 2 - 1) * 0.15);
    // Craggy top, flat-ish underside
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(-w * 0.7, -h * 0.6);
    ctx.lineTo(-w * 0.2, -h);
    ctx.lineTo(w * 0.15, -h * 0.75);
    ctx.lineTo(w * 0.65, -h * 0.9);
    ctx.lineTo(w, -h * 0.2);
    ctx.lineTo(w * 0.7, h * 0.35);
    ctx.lineTo(-w * 0.5, h * 0.4);
    ctx.closePath();
    ctx.fill();
    // Tiny dangling spire under one isle
    if (rand() > 0.45) {
      ctx.beginPath();
      ctx.moveTo(-3 * scale, h * 0.3);
      ctx.lineTo(0, h * 0.3 + 12 * scale);
      ctx.lineTo(3 * scale, h * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

export const LANDMARKS = {
  JADE: [paintTree(4, 22.5)],
  ARCTIC: [paintCrystals],
  SAKURA: [paintTorii, paintTree(3, 25)],
  CYBER: [paintLatticeTower],
  VOID: [paintMonoliths],
  EMBER: [paintSpires],
  TWILIGHT: [paintMenhirs, paintRuinTower],
  SOLAR: [paintObelisks],
  STORM: [paintTree(3, 32)], // sparse wind-blasted trees
  MIRROR: [paintReeds], // lakeside reeds, low enough to keep the water reads clear
  ABYSS: [paintChimneys], // hydrothermal chimneys on the abyssal ridge
  DUNE: [paintArch],
  CORAL: [paintCoralFan],
  LUMEN: [paintMushrooms],
  AURUM: [paintSheaves, paintTree(3, 20)],
  NEBULA: [paintFloatIsles],
};

/**
 * Sprinkle a biome's landmarks onto a generated silhouette strip. Each
 * one roots on the noise ridge at its own x (sunk a few px into the fill
 * so silhouettes merge seamlessly), kept clear of the strip's wrap seam.
 */
export function decorateStrip(strip, biomeName, seed, color, { count = 3, scale = 1 } = {}) {
  const painters = LANDMARKS[biomeName];
  if (!painters) return;
  const ctx = strip.getContext('2d');
  const rand = mulberry32(seed >>> 0 || 1);
  const margin = 120;
  const span = strip.width - margin * 2;
  for (let i = 0; i < count; i++) {
    const x = margin + ((i + 0.15 + rand() * 0.7) / count) * span;
    const rootY = ridgeYAt(strip, x) + 6;
    const painter = painters[Math.floor(rand() * painters.length)];
    painter(ctx, x, rootY, scale * (0.85 + rand() * 0.4), rand, color);
  }
}
