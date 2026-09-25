import { sampleTerrainCurve } from '../TerrainRelief.js';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function buildGroundPatches({ seed, biomeKey, worldX, viewWidth, moisture }) {
  const patches = [];
  const start = Math.floor((worldX - 128) / 256);
  const end = Math.ceil((worldX + viewWidth + 128) / 256);
  for (let sector = start; sector <= end; sector++) for (let i = 0; i < 3; i++) {
    const id = `${seed}:${biomeKey}:${sector}:${i}`;
    const amount = hash(`${id}:chance`);
    if (amount > .48) continue;
    const wx = sector * 256 + 12 + hash(`${id}:x`) * 232;
    if (wx < worldX - 128 || wx > worldX + viewWidth + 128) continue;
    const widthPx = 16 + hash(`${id}:width`) * 74;
    let kind = 'ledge';
    if (biomeKey === 'ICEFIELD') kind = 'snow';
    else if (biomeKey === 'DESERT' || biomeKey === 'CANYON') kind = 'soil';
    else if (amount < .12 && moisture >= .5) kind = 'pool';
    else if (moisture > .4 && amount < .35) kind = 'moss';
    patches.push({ id, wx, widthPx, depthPx: kind === 'pool' ? 4 + hash(`${id}:d`) * 8 : 6 + hash(`${id}:d`) * 30, kind });
    if (patches.length >= 24) return patches;
  }
  return patches;
}

export function drawGroundMaterial(ctx, { patches, bars, worldX, originX, policy, alpha = 1 }) {
  const curve = sampleTerrainCurve(bars);
  const wetMasks = [], litEdges = [];
  if (!curve.length) return { wetMasks, litEdges };
  for (const patch of patches) {
    const x = patch.wx - worldX + originX;
    if (x + patch.widthPx < curve[0].x || x > curve.at(-1).x) continue;
    const left = Math.max(0, Math.min(curve.length - 1, Math.round((x - curve[0].x) / 10)));
    const right = Math.max(0, Math.min(curve.length - 1, Math.round((x + patch.widthPx - curve[0].x) / 10)));
    if (right <= left) continue;
    const y = curve[left].y;
    const slope = Math.abs(curve[right].y - y) / Math.max(1, patch.widthPx);
    const kind = patch.kind === 'pool' && slope > .12 ? 'ledge' : patch.kind;
    const palettes = { ledge: 'rgba(10,18,20,0.13)', moss: 'rgba(26,55,38,0.18)',
      snow: 'rgba(225,236,235,0.22)', soil: 'rgba(78,60,45,0.16)', pool: 'rgba(12,38,45,0.32)' };
    ctx.fillStyle = palettes[kind] || palettes.ledge;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(x, y + 2);
    for (let i = left; i <= right; i++) ctx.lineTo(curve[i].x, curve[i].y + 2);
    ctx.lineTo(x + patch.widthPx, y + patch.depthPx);
    ctx.lineTo(x, y + patch.depthPx); ctx.closePath(); ctx.fill();
    if (kind === 'pool' && policy.moisture >= .5 && wetMasks.length < 6) wetMasks.push({ id: patch.id, x, y, widthPx: patch.widthPx, depthPx: patch.depthPx, alpha });
    if (kind === 'ledge' || kind === 'pool') litEdges.push({ x, y, widthPx: patch.widthPx, alpha });
  }
  ctx.globalAlpha = 1;
  return { wetMasks, litEdges };
}
