// Passive listening stage: one heard-time snapshot, painted directly into
// the authoritative canvas. No simulation, dispatch, capture or frame history.
import {
  MIDIO_BODY, midioEyeMesh, MIDIO_EYE_CY,
  BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW, BROSHI_EYE, BROSHI_TAIL,
  MIDASUS_MESH, BABY_STAR_MESH,
} from '../../render/meshes.js';
import { computeRestLengths, applyTransform, drawMeshPart, drawGlowHalo } from '../../render/MeshDrawer.js';
import { midioMotion } from '../../render/MidioMotion.js';
import { MIDIO_IDENTITY_HUE } from '../../render/ColorLaw.js';

const IDS = ['midio', 'broshi', 'midasus'];
const HUES = { midio: MIDIO_IDENTITY_HUE, broshi: 16, midasus: 276 };
const REST = new Map([MIDIO_BODY, BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW,
  BROSHI_EYE, BROSHI_TAIL, MIDASUS_MESH, BABY_STAR_MESH]
  .map(mesh => [mesh, computeRestLengths(mesh)]));
const unit = v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freeze(v);
  }
  return o;
}
function box(points, padding = 0) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs) - padding, y = Math.min(...ys) - padding;
  return { x, y, width: Math.max(...xs) - x + padding, height: Math.max(...ys) - y + padding };
}
function union(bounds) {
  return box(bounds.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]));
}
function parts(a) {
  if (a.id === 'midio') return [MIDIO_BODY];
  if (a.id === 'midasus') return [MIDASUS_MESH];
  const [anchor, tip] = BROSHI_TAIL.vertices;
  const dx = tip.x - anchor.x, dy = tip.y - anchor.y;
  const tail = { edges: BROSHI_TAIL.edges, vertices: [anchor, {
    x: anchor.x + dx * Math.cos(a.tailAngle) - dy * Math.sin(a.tailAngle),
    y: anchor.y + dx * Math.sin(a.tailAngle) + dy * Math.cos(a.tailAngle),
  }] };
  const jaw = { edges: BROSHI_JAW.edges, vertices: [BROSHI_JAW.vertices[0],
    { ...BROSHI_JAW.vertices[1], y: BROSHI_JAW.vertices[1].y + a.jawOpen * 7 }] };
  return [BROSHI_BODY, BROSHI_HEAD, jaw, tail, BROSHI_EYE];
}

/** Read a canonical musical snapshot. Missing/silent analysis leaves all
 * three figures present and still; uncertain pitch changes glow, not height. */
export function sampleRangePerformance({ timeMs = 0, music = null, width = 1280, height = 720,
  reducedMotion = false, reducedFlash = false } = {}) {
  width = Number.isFinite(width) && width > 0 ? width : 1280;
  height = Number.isFinite(height) && height > 0 ? height : 720;
  timeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const s = Math.min(width / 1280, height / 720), t = timeMs / 1000;
  const presence = unit(music?.motionPresence01 ?? music?.activity01);
  const rhythmValue = unit(music?.kick01) * presence, accentValue = unit(music?.rhythmAccent01) * presence;
  const rhythm = rhythmValue > 1e-4 ? rhythmValue : 0;
  const accent = accentValue > 1e-4 ? accentValue : 0;
  const motion = reducedMotion ? 0 : 1, flash = reducedFlash ? .26 : 1;
  const x = width * .3, y = height * .81, w = width * .31, depth = 18 * s;
  const top = [{ x: x + 14 * s, y: y - 18 * s }, { x: x + w - 18 * s, y: y - 18 * s },
    { x: x + w, y }, { x, y }];
  const front = [top[3], top[2], { x: x + w - 4 * s, y: y + depth }, { x: x + 5 * s, y: y + depth }];
  const platform = { x, y, width: w, depth, top, front, bounds: box([...top, ...front], 2 * s) };
  const readings = music?.trioSources || {};
  const actors = IDS.map((id, i) => {
    const source = readings[id] || {};
    const activity = unit(source.activity), pitchActivity = unit(source.pitchActivity);
    const pitch01 = pitchActivity > 0 ? unit(source.pitch01) : .5;
    const pitch = (pitch01 - .5) * pitchActivity;
    const contact = { x: x + w * [.17, .51, .84][i], y: y - [5, 3, 7][i] * s };
    const a = { id, hue: HUES[id], source: source.source ?? null,
      contributors: (source.contributors || []).map(c => ({ ...c })),
      sharedSource: source.source != null && IDS.some(other => other !== id && readings[other]?.source === source.source),
      activity, pitchActivity, pitch01, contact, hopPx: 0,
      glow: .18 + flash * (.32 * activity + .22 * rhythm + .12 * accent), jawOpen: 0, tailAngle: 0 };
    if (id === 'midio') {
      const m = midioMotion(t, activity, motion * activity);
      a.hopPx = motion * 25 * s * rhythm;
      a.transform = { tx: contact.x, ty: contact.y - a.hopPx + m.hoverPx * s,
        rot: motion * (m.precessDeg * Math.PI / 180 + .12 * pitch),
        scaleX: 1.6 * s * (1 + motion * (.05 * activity + .07 * rhythm)),
        scaleY: 1.6 * s * (1 + motion * (.035 * activity + .1 * rhythm)) };
    } else if (id === 'broshi') {
      const bass = Math.max(activity, presence > 1e-4 ? unit(music?.bassPressure01) : 0);
      a.hopPx = motion * s * (10 * bass * (.5 + .5 * Math.sin(t * 4.3)) + 13 * rhythm);
      a.transform = { tx: contact.x, ty: contact.y - a.hopPx,
        rot: motion * bass * .08 * Math.sin(t * 4.3 + .5) || 0,
        scaleX: 1.3 * s * (1 + motion * .13 * bass),
        scaleY: 1.3 * s * (1 - motion * .065 * bass + motion * .1 * rhythm) };
      a.jawOpen = motion * (.5 * bass + .3 * accent);
      a.tailAngle = motion * bass * .24 * Math.sin(t * 3.4) || 0;
    } else {
      a.hopPx = motion * (8 * rhythm + 20 * pitch) * s;
      a.transform = { tx: contact.x + motion * activity * 9 * s * Math.sin(t * 1.8),
        ty: contact.y - 69 * s - a.hopPx - motion * activity * 6 * s * Math.sin(t * 2.1),
        rot: motion * (.2 * activity * Math.sin(t * 1.6) + .4 * pitch),
        scaleX: 2.6 * s * (1 + motion * .12 * activity),
        scaleY: 2.6 * s * (1 + motion * .12 * activity) };
      a.babies = [0, 1, 2].map(j => {
        const angle = j * Math.PI * 2 / 3 - .35;
        const drift = motion * activity;
        const live = angle + t * .8;
        return { x: a.transform.tx + 34 * s * ((1 - drift) * Math.cos(angle) + drift * Math.cos(live)),
          y: a.transform.ty + 23 * s * ((1 - drift) * Math.sin(angle) + drift * Math.sin(live)),
          rot: motion * activity * .3 * Math.sin(t + j) || 0, scale: .86 * s };
      });
    }
    const points = parts(a).flatMap(mesh => mesh.vertices.map(v => applyTransform(v, a.transform)));
    for (const baby of a.babies || []) points.push({ x: baby.x - 6 * s, y: baby.y - 6 * s }, { x: baby.x + 6 * s, y: baby.y + 6 * s });
    a.bounds = box(points, 9 * s);
    const waterY = y + depth + 7 * s;
    a.reflection = { transform: { ...a.transform, ty: waterY + (waterY - a.transform.ty) * .42,
      scaleY: -a.transform.scaleY * .42, rot: -a.transform.rot },
    bounds: { x: a.bounds.x - 3 * s, y: waterY + (waterY - a.bounds.y - a.bounds.height) * .42,
      width: a.bounds.width + 6 * s, height: a.bounds.height * .42 },
    alpha: .075 + flash * .04 * activity };
    return a;
  });
  return freeze({ timeMs, width, height, scale: s, reducedMotion: !!reducedMotion, reducedFlash: !!reducedFlash,
    platform, actors, bounds: union([platform.bounds, ...actors.flatMap(a => [a.bounds, a.reflection.bounds])]) });
}

function polygon(ctx, points, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function paintDock(ctx, frame) {
  const { platform: p, scale: s } = frame;
  const front = ctx.createLinearGradient(0, p.y, 0, p.y + p.depth);
  front.addColorStop(0, '#343d43'); front.addColorStop(.2, '#242d33'); front.addColorStop(1, '#111b23');
  polygon(ctx, p.front, front, 'rgba(8,15,23,.85)', 1.4 * s);
  const top = ctx.createLinearGradient(0, p.y - 18 * s, 0, p.y);
  top.addColorStop(0, '#4b555a'); top.addColorStop(.5, '#39474d'); top.addColorStop(1, '#546065');
  polygon(ctx, p.top, top, 'rgba(151,179,185,.55)', .9 * s);
  // Recessed joints follow the top's perspective; the front bevel catches
  // light above the dark riser, keeping the slab legible over real water.
  for (let i = 1; i < 6; i++) {
    const u = i / 6;
    ctx.beginPath(); ctx.moveTo(p.top[0].x + (p.top[1].x - p.top[0].x) * u, p.top[0].y);
    ctx.lineTo(p.x + p.width * u, p.y);
    ctx.strokeStyle = 'rgba(14,27,32,.65)'; ctx.lineWidth = 1.3 * s; ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(p.x + 2 * s, p.y + 2 * s); ctx.lineTo(p.x + p.width - 2 * s, p.y + 2 * s);
  ctx.strokeStyle = 'rgba(164,191,192,.48)'; ctx.lineWidth = 1.8 * s; ctx.stroke();
}
function meshRest(mesh, a, index) {
  if (REST.has(mesh)) return REST.get(mesh);
  return REST.get(index === 2 ? BROSHI_JAW : BROSHI_TAIL);
}
function paintGlyph(ctx, a, transform, { reflection = false, light = null, scale = 1 } = {}) {
  const meshes = parts(a);
  const options = { satBase: reflection ? 44 : 48, lightBase: reflection ? 56 : 77,
    glowBoost: reflection ? 6 : 13, widthBase: (reflection ? .9 : 1.55) * scale,
    widthGlow: .7 * scale, alpha: reflection ? .7 : .95,
    outline: reflection ? false : { widthAdd: 1.8 * scale }, light, rimAmount: .32 };
  meshes.forEach((mesh, i) => {
    if (!reflection && mesh.vertices.length > 5) polygon(ctx, mesh.vertices.slice(1).map(v => applyTransform(v, transform)),
      `hsla(${a.hue},36%,57%,.10)`);
    drawMeshPart(ctx, mesh, meshRest(mesh, a, i), transform, a.hue, options);
  });
  if (a.id === 'midio') {
    const eye = midioEyeMesh(1.7, -.6);
    drawMeshPart(ctx, eye, [2], transform, a.hue, { ...options, lightBase: 92, widthBase: 2.3 * scale });
    if (!reflection) {
      const hub = applyTransform({ x: 0, y: MIDIO_EYE_CY }, transform);
      ctx.beginPath(); ctx.ellipse(hub.x, hub.y, 7.6 * scale, 3.7 * scale, transform.rot, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${a.hue},48%,84%,.7)`; ctx.lineWidth = .8 * scale; ctx.stroke();
    }
  }
}

/** Paint only the compact dock, glyphs and local light/reflection strokes.
 * The geographic lake and its mask remain owned by the landscape renderer. */
export function drawRangePerformance(ctx, frame, { light = null } = {}) {
  const s = frame.scale;
  ctx.save();
  for (const a of frame.actors) {
    ctx.save();
    ctx.globalAlpha = a.reflection.alpha;
    ctx.beginPath();
    const b = a.reflection.bounds;
    const strips = Math.max(3, Math.ceil(b.height / (5 * s)));
    for (let i = 0; i < strips; i++) {
      const shift = frame.reducedMotion ? 0 : Math.sin(frame.timeMs / 1100 + i * 2.1) * 1.5 * s;
      ctx.rect(b.x + shift, b.y + i * b.height / strips, b.width, b.height / strips * .55);
    }
    ctx.clip();
    paintGlyph(ctx, a, a.reflection.transform, { reflection: true, scale: s });
    ctx.restore();
  }
  paintDock(ctx, frame);
  for (const a of frame.actors) {
    // A short soft pool belongs to the dock contact, not a full-frame veil.
    drawGlowHalo(ctx, a.contact.x, a.contact.y - 2 * s, 23 * s, 5 * s,
      a.hue, a.glow * .36, { sat: 58, light: 66 });
    const hub = a.id === 'midio' ? MIDIO_BODY.vertices[0]
      : a.id === 'broshi' ? BROSHI_BODY.vertices[0] : MIDASUS_MESH.vertices[0];
    const center = applyTransform(hub, a.transform);
    drawGlowHalo(ctx, center.x, center.y, a.id === 'midasus' ? 27 * s : 21 * s,
      a.id === 'midio' ? 38 * s : 24 * s, a.hue, a.glow * .5, { sat: 48, light: 78 });
    paintGlyph(ctx, a, a.transform, { light, scale: s });
    for (const baby of a.babies || []) {
      drawGlowHalo(ctx, baby.x, baby.y, 7 * s, 7 * s, a.hue, a.glow * .34);
      drawMeshPart(ctx, BABY_STAR_MESH, REST.get(BABY_STAR_MESH),
        { tx: baby.x, ty: baby.y, rot: baby.rot, scaleX: baby.scale, scaleY: baby.scale }, a.hue,
        { satBase: 42, lightBase: 82, widthBase: .95 * s, widthGlow: .4 * s, light });
    }
  }
  ctx.restore();
  return freeze({ actorCount: frame.actors.length, reflectionCount: frame.actors.length, bounds: frame.bounds,
    platformBounds: frame.platform.bounds, actorBounds: Object.fromEntries(frame.actors.map(a => [a.id, a.bounds])),
    sources: Object.fromEntries(frame.actors.map(a => [a.id, a.source])) });
}
