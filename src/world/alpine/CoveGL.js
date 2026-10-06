// The cove's inhabitants share the terrain camera, depth, light and mirror.
// Shapes are small extruded versions of the retained character glyphs; their
// edges are narrow triangle prisms, so WebGL line-width limits do not erase
// them. All roots stay in world space and land roots ride the terrain field.
import { DEFORM_GLSL } from './TerrainMaterial.js';
import { MIST_GLSL } from './RangeAtmosphere.js';
import { ACTOR_GLSL } from './ActorsGL.js';
import {
  MIDIO_BODY, midioEyeMesh, BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW,
  BROSHI_EYE, BROSHI_TAIL, MIDASUS_MESH, BABY_STAR_MESH,
} from '../../render/meshes.js';

// Covers the fixed residents, three companions and bounded natural dressing.
// Reserved by RangeScene before constructing geometry, including attributes.
export const COVE_GPU_BYTES = 768 * 1024;
const MAX_ROCKS = 12, MAX_REEDS = 8;

export const COVE_VERT = /* glsl */`
  invariant gl_Position;
  ${DEFORM_GLSL}
  uniform vec3 uRoot;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uForward;
  uniform float uOrbitRadius;
  uniform float uSize;
  uniform float uLean;
  uniform float uTurn;
  uniform float uGrounded;
  uniform float uHead;
  uniform float uTail;
  uniform float uJaw;
  uniform float uStroke;
  uniform float uWalking;
  uniform vec3 uFrontFoot;
  uniform vec3 uRearFoot;
  uniform float uBodyLift;
  uniform vec2 uTailPivot;
  uniform vec2 uJawPivot;
  in float aEdge;
  in float aShade;
  in float aJoint;
  out vec3 vWorld;
  out vec3 vNormal;
  out float vEdge;
  out float vShade;
  vec2 rotate2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  void main() {
    vec3 p = position, n = normal;
    if (aJoint > 0.5 && aJoint < 2.5) {
      bool tail = aJoint < 1.5;
      vec2 pivot = tail ? uTailPivot : uJawPivot;
      float a = tail ? uTail : -uJaw * 0.22;
      p.xy = pivot + rotate2(p.xy - pivot, a);
      n.xy = rotate2(n.xy, a);
    }
    if (aJoint > 1.5) {
      vec2 headPivot = vec2(8.0 / 34.0, 14.0 / 34.0);
      p.xy = headPivot + rotate2(p.xy - headPivot, uHead);
      n.xy = rotate2(n.xy, uHead);
    }
    // Midio's tapered lower body flexes through each swimming stroke.
    // The same deformation reaches the color and both occlusion passes.
    float stroke = uStroke * (1.0 - smoothstep(-0.12, 0.36, position.y));
    vec2 swimPivot = vec2(0.0, 0.24);
    p.xy = swimPivot + rotate2(p.xy - swimPivot, stroke);
    n.xy = rotate2(n.xy, stroke);
    if (uWalking > 0.5) {
      // The retained Broshi glyph's two ground spikes act as feet. Only the
      // lower body bends; planted tips stay on the bank while the torso
      // transfers its weight. Color and both depth passes use this block.
      float footWeight = (1.0 - smoothstep(0.02, 0.36, position.y))
        * (1.0 - step(0.5, aJoint));
      float front = smoothstep(-0.14, 0.06, position.x);
      p += mix(uRearFoot, uFrontFoot, front) * footWeight / uSize;
      p.y += uBodyLift * (1.0 - footWeight) / uSize;
      vec2 hip = vec2(-3.0 / 34.0, 0.32);
      p.xy = mix(p.xy, hip + rotate2(p.xy - hip, uLean), 1.0 - footWeight);
      n.xy = rotate2(n.xy, uLean * (1.0 - footWeight));
    } else {
      // Existing cove poses keep their original root-pivot articulation.
      p.xy = rotate2(p.xy, uLean);
      n.xy = rotate2(n.xy, uLean);
    }
    p.xz = rotate2(p.xz, uTurn);
    n.xz = rotate2(n.xz, uTurn);
    vec3 root = uRoot;
    if (uOrbitRadius <= 0.0) root.y += uGrounded * deformAt(uRoot);
    vWorld = root + (uRight * p.x + uUp * p.y + uForward * p.z) * uSize;
    vNormal = normalize(uRight * n.x + uUp * n.y + uForward * n.z);
    vEdge = aEdge;
    vShade = aShade;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

export const COVE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uBodyColor;
  uniform vec3 uEdgeColor;
  uniform float uGlow;
  uniform float uShadow;
  uniform float uShadowOpacity;
  uniform float uClipBelow;
  uniform float uOrbitRadius;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uAirColor;
  uniform vec3 uCameraPos;
  uniform float uAirDensity;
  uniform float uAirHeightFalloff;
  uniform float uAmbientScale;
  uniform float uExposure;
  ${ACTOR_GLSL}
  ${MIST_GLSL}
  in vec3 vWorld;
  in vec3 vNormal;
  in float vEdge;
  in float vShade;
  out vec4 outColor;
  vec3 tonemap(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  void main() {
    if (uOrbitRadius > 0.0) {
      if (length(vWorld + vec3(0.0, uOrbitRadius, 0.0)) - uOrbitRadius < uClipBelow) discard;
    } else if (vWorld.y < uClipBelow) discard;
    if (uShadow > 0.5) {
      outColor = vec4(0.025, 0.04, 0.045, 0.28 * uShadowOpacity * pow(max(0.0, 1.0 - vShade), 2.0));
      return;
    }
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float key = max((dot(n, uLightDir) + 0.2) / 1.2, 0.0);
    vec3 hemi = mix(uSkyHorizon * 0.65, uSkyZenith, 0.5 + 0.5 * n.y) * uAmbientScale;
    vec3 albedo = uBodyColor * vShade;
    vec3 lit = albedo * (hemi + uLightColor * key);
    lit += albedo * actorLight(vWorld, n);
    float edgeScale = 1.0;
    if (uOrbitRadius > 0.0) {
      // Broad moonlit sky keeps the modeled facets legible even when the
      // shared night environment is too dim to illuminate their albedo.
      vec3 radialUp = normalize(vWorld + vec3(0.0, uOrbitRadius, 0.0));
      vec3 fillDirection = normalize(radialUp + vec3(-0.35, 0.2, 0.8));
      float skyFill = 0.20 + 0.15 * max(dot(n, fillDirection), 0.0);
      lit += albedo * vec3(0.84, 0.91, 1.0) * skyFill;
      edgeScale = 0.5;
    }
    // The body catches moonlight; emission is concentrated in fine seams.
    lit += uEdgeColor * (vEdge * (0.07 + 0.30 * uGlow) + 0.009 * uGlow) * edgeScale;
    vec3 color = tonemap(lit * uExposure);
    color = mix(color, mistColorAt(uCameraPos, vWorld), mistAmount(uCameraPos, vWorld));
    float dist = length(vWorld - uCameraPos);
    float heightTerm = exp(-max(0.0, vWorld.y - uCameraPos.y * 0.25) * uAirHeightFalloff);
    float air = 1.0 - exp(-dist * uAirDensity * (0.35 + 0.65 * heightTerm));
    color = mix(color, uAirColor, clamp(air, 0.0, 0.96));
    outColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
  }
`;

export const COVE_DEPTH_FRAG = /* glsl */`
  precision highp float;
  uniform float uClipBelow;
  uniform float uOrbitRadius;
  in vec3 vWorld;
  out vec4 outColor;
  void main() {
    if (uOrbitRadius > 0.0) {
      if (length(vWorld + vec3(0.0, uOrbitRadius, 0.0)) - uOrbitRadius < uClipBelow) discard;
    } else if (vWorld.y < uClipBelow) discard;
    outColor = vec4(0.0);
  }
`;

const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const unit = v => Math.max(0, Math.min(1, finite(v)));
const PALETTE = {
  midio: ['#284e4c', '#8bd5cc'],
  broshi: ['#674a37', '#d6a37c'],
  midasus: ['#4a3d64', '#bea8dc'],
  rock: ['#464d48', '#000000'],
  reed: ['#364a39', '#000000'],
  pine: ['#293a32', '#000000'],
};

function builder() {
  const position = [], normal = [], edge = [], shade = [], joint = [];
  return {
    triangle(a, b, c, { luminous = 0, tint = 1, part = 0, radial = null } = {}) {
      const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...n);
      if (length < 1e-10) return;
      for (const [i, p] of [a, b, c].entries()) {
        position.push(...p); normal.push(...n.map(v => v / length));
        edge.push(luminous); shade.push(radial ? radial[i] : tint); joint.push(part);
      }
    },
    geometry(THREE) {
      const g = new THREE.BufferGeometry();
      for (const [name, values, size] of [['position', position, 3], ['normal', normal, 3],
        ['aEdge', edge, 1], ['aShade', shade, 1], ['aJoint', joint, 1]])
        g.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
      return g;
    },
  };
}

/** Four-sided prism around an edge, including its end caps. */
function edgePrism(out, a, b, width, options = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
  const x = -dy / length * width / 2, y = dx / length * width / 2, z = width * .32;
  const at = p => [[p[0] + x, p[1] + y, p[2] - z], [p[0] - x, p[1] - y, p[2] - z],
    [p[0] - x, p[1] - y, p[2] + z], [p[0] + x, p[1] + y, p[2] + z]];
  const front = at(a), back = at(b);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    out.triangle(front[i], back[i], back[j], options);
    out.triangle(front[i], back[j], front[j], options);
  }
  out.triangle(...front.slice(0, 3), options); out.triangle(front[0], front[2], front[3], options);
  out.triangle(back[0], back[2], back[1], options); out.triangle(back[0], back[3], back[2], options);
}

// Emit retained lines along the front envelope of filled facets. Splitting
// at face boundaries lets a brace cross the ridge instead of tunneling into
// it; overlapping star triangles use the nearer of their two face surfaces.
function facetEdge(out, a, b, width, faces, options) {
  const cuts = [0, 1], dx = b[0] - a[0], dy = b[1] - a[1];
  let slope = 0;
  const projected = faces.map(([p, q, r]) => {
    const qx = q[0] - p[0], qy = q[1] - p[1], rx = r[0] - p[0], ry = r[1] - p[1];
    const determinant = qx * ry - qy * rx;
    const zx = ((q[2] - p[2]) * ry - (r[2] - p[2]) * qy) / determinant;
    const zy = (qx * (r[2] - p[2]) - rx * (q[2] - p[2])) / determinant;
    slope = Math.max(slope, Math.hypot(zx, zy));
    for (const [u, v] of [[p, q], [q, r], [r, p]]) {
      const ex = v[0] - u[0], ey = v[1] - u[1], cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-10) continue;
      const px = u[0] - a[0], py = u[1] - a[1];
      const t = (px * ey - py * ex) / cross, edgeT = (px * dy - py * dx) / cross;
      if (t > 0 && t < 1 && edgeT >= 0 && edgeT <= 1) cuts.push(t);
    }
    return { p, qx, qy, rx, ry, determinant, zx, zy };
  });
  // Account for the line's finite width and back face as well as its center.
  const clearance = .009 + width * (.32 + .5 * slope);
  const at = t => {
    const x = a[0] + dx * t, y = a[1] + dy * t;
    let z = a[2] + (b[2] - a[2]) * t;
    for (const f of projected) {
      const px = x - f.p[0], py = y - f.p[1];
      const u = (px * f.ry - py * f.rx) / f.determinant;
      const v = (f.qx * py - f.qy * px) / f.determinant;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7)
        z = Math.min(z, f.p[2] + f.zx * px + f.zy * py);
    }
    return [x, y, z - clearance];
  };
  const stops = cuts.sort((x, y) => x - y).filter((t, i, values) => i === 0 || t - values[i - 1] > 1e-7);
  for (let i = 1; i < stops.length; i++) edgePrism(out, at(stops[i - 1]), at(stops[i]), width, options);
}

function glyph(out, mesh, { height, offsetY = 0, depth = .07, solid = true, star = false, part = 0, width = .014 } = {}) {
  const points = mesh.vertices.map(p => [p.x / height, -p.y / height + offsetY, -depth]);
  const frontFaces = [];
  if (solid && points.length > 3) {
    // Retain the authored silhouette and braces, but raise the shard's hub
    // into a low ridge so filled faces catch light at different angles.
    const hub = [points[0][0], points[0][1], -depth - .12];
    points[0] = hub;
    const triangles = star ? [[1, 2, 3], [4, 5, 6]]
      : points.slice(1).map((_, i) => [0, i + 1, (i + 1) % (points.length - 1) + 1]);
    for (const [i, j, k] of triangles) {
      const faces = star ? [[hub, points[i], points[j]], [hub, points[j], points[k]], [hub, points[k], points[i]]]
        : [[points[i], points[j], points[k]]];
      frontFaces.push(...faces);
      for (const [a, b, c] of faces) out.triangle(c, b, a, { tint: .88 + (j % 4) * .08, part });
      out.triangle(...[points[i], points[j], points[k]].map(p => [p[0], p[1], depth]), { tint: .72, part });
    }
    const rim = star ? [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]]
      : points.slice(1).map((_, i) => [i + 1, (i + 1) % (points.length - 1) + 1]);
    for (const [i, j] of rim) {
      const a = points[i], b = points[j], c = [b[0], b[1], depth], d = [a[0], a[1], depth];
      out.triangle(a, b, c, { tint: .6, part }); out.triangle(a, c, d, { tint: .6, part });
    }
  }
  for (const [i, j] of mesh.edges) {
    if (frontFaces.length) facetEdge(out, points[i], points[j], width, frontFaces, { luminous: 1, tint: .8, part });
    else {
      const a = points[i].slice(), b = points[j].slice();
      a[2] -= .009; b[2] -= .009;
      edgePrism(out, a, b, width, { luminous: 1, tint: .8, part });
    }
  }
}

function actorGeometry(THREE, id) {
  const out = builder();
  if (id === 'midio') {
    glyph(out, MIDIO_BODY, { height: 62, offsetY: -.24, depth: .075, width: .015 });
    // A small iris rests toward the lake rather than watching the camera.
    glyph(out, midioEyeMesh(2.5, -.3), { height: 62, offsetY: -.24, depth: .215, solid: false, width: .045 });
  } else if (id === 'broshi') {
    glyph(out, BROSHI_BODY, { height: 34, depth: .09, width: .014 });
    glyph(out, BROSHI_HEAD, { height: 34, depth: .09, width: .014, part: 3 });
    glyph(out, BROSHI_EYE, { height: 34, depth: .23, solid: false, width: .014, part: 3 });
    glyph(out, BROSHI_TAIL, { height: 34, depth: .02, solid: false, part: 1, width: .02 });
    glyph(out, BROSHI_JAW, { height: 34, depth: .09, solid: false, part: 2, width: .017 });
  } else {
    glyph(out, id === 'baby' ? BABY_STAR_MESH : MIDASUS_MESH,
      { height: id === 'baby' ? 7.2 : 17, depth: .05, star: true, width: id === 'baby' ? .055 : .022 });
  }
  return out.geometry(THREE);
}

function rockGeometry(THREE, radius, height, seed) {
  const out = builder(), n = 7;
  const ring = (h, size) => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2, r = radius * size * (.83 + .17 * Math.sin(i * 4.7 + seed));
    return [Math.cos(a) * r, h + Math.sin(i * 2.2 + seed) * height * .06, Math.sin(a) * r * .72];
  });
  const base = ring(-height * .16, 1), belt = ring(height * .48, 1.07), top = ring(height * .8, .55);
  const crown = [radius * .09, height, -radius * .1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.triangle(base[i], belt[i], belt[j]); out.triangle(base[i], belt[j], base[j]);
    out.triangle(belt[i], top[i], top[j], { tint: .85 }); out.triangle(belt[i], top[j], belt[j]);
    out.triangle(top[i], crown, top[j], { tint: 1.05 });
  }
  return out.geometry(THREE);
}

function reedsGeometry(THREE, height, spread, seed) {
  const out = builder();
  for (let i = 0; i < 7; i++) {
    const phase = seed + i * 2.399, x = Math.cos(phase) * spread * .45, z = Math.sin(phase) * spread * .45;
    const h = height * (.6 + .4 * (i % 3) / 2), bend = spread * .24 * Math.sin(phase);
    edgePrism(out, [x, 0, z], [x + bend * .6, h * .72, z + .14 * h], Math.max(.13, height * .024), { tint: .75 });
    edgePrism(out, [x + bend * .6, h * .72, z + .14 * h], [x + bend, h, z + .19 * h], Math.max(.11, height * .02));
    for (const side of [-1, 1]) {
      const start = [x + bend * .3, h * .3, z + h * .05];
      out.triangle(start, [start[0] + side * h * .26, h * .71, z + h * .18],
        [start[0] + side * h * .06, h * .45, z + h * .06], { tint: .82 });
    }
  }
  return out.geometry(THREE);
}

function pineGeometry(THREE, height, width) {
  const out = builder(), sides = 7;
  // An irregular tapered trunk, then open tiers whose gaps reveal stars.
  const ring = (y, r, twist = 0) => Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2 + twist;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const base = ring(0, width * .033), top = ring(height * .92, width * .01);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    out.triangle(base[i], top[i], top[j], { tint: .67 }); out.triangle(base[i], top[j], base[j], { tint: .67 });
  }
  for (let k = 0; k < 7; k++) {
    const y = height * (.15 + k * .11), r = width * .5 * (1 - k / 8);
    const rim = ring(y, r, k * .6).map((p, i) => [p[0] * (.88 + .12 * (i % 2)), p[1] + Math.sin(i * 2.3 + k) * height * .016, p[2]]);
    const apex = [Math.sin(k * 1.7) * width * .03, Math.min(height, y + height * .24), 0];
    for (let i = 0; i < sides; i++) out.triangle(rim[i], apex, rim[(i + 1) % sides], { tint: .72 + k * .045 });
  }
  return out.geometry(THREE);
}

function contactGeometry(THREE, width, depth) {
  const out = builder(), segments = 24;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
    out.triangle([0, .09, 0], [Math.cos(a) * width, .09, Math.sin(a) * depth],
      [Math.cos(b) * width, .09, Math.sin(b) * depth], { radial: [0, 1, 1] });
  }
  return out.geometry(THREE);
}

function geometryBytes(geometry) {
  return Object.values(geometry.attributes).reduce((total, a) => total + a.array.byteLength, geometry.index?.array.byteLength || 0);
}

export class CoveGL {
  constructor(THREE, sharedUniforms, layout) {
    this.THREE = THREE;
    this.layout = layout;
    this.group = new THREE.Group();
    this.depthGroup = new THREE.Group();
    this.bandDepthGroup = new THREE.Group();
    this.actors = {};
    this.dressing = [];
    this.geometries = new Set();
    this.materials = new Set();
    this.gpuBytes = 0;
    this.snapshot = null;
    this.disposed = false;
    this._shared = sharedUniforms;
    for (const id of ['midio', 'broshi', 'midasus']) {
      const record = this._add(actorGeometry(THREE, id), id, layout.anchors[id], { grounded: id === 'broshi', size: layout.heights[id] });
      this.actors[id] = record;
      record.babies = [];
      if (id === 'midasus') {
        const geometry = actorGeometry(THREE, 'baby');
        for (let i = 0; i < 3; i++) {
          const baby = this._add(geometry, 'midasus', layout.anchors.midasus, { size: 3 });
          this._visible(baby, false);
          record.babies.push(baby);
        }
      }
    }
    const dressing = layout.dressing || {};
    for (const [i, rock] of (dressing.rocks || []).slice(0, MAX_ROCKS).entries()) {
      this.dressing.push(this._add(rockGeometry(THREE, Math.max(.1, finite(rock.radiusM, 3)), Math.max(.1, finite(rock.heightM, 2)), i * 2.9),
        'rock', rock.positionM, { grounded: true }));
    }
    for (const [i, reed] of (dressing.reeds || []).slice(0, MAX_REEDS).entries()) {
      this.dressing.push(this._add(reedsGeometry(THREE, Math.max(.1, finite(reed.heightM, 6)), Math.max(.1, finite(reed.spreadM, 4)), i * 2.3),
        'reed', reed.positionM, { grounded: true }));
    }
    if (dressing.pine) {
      const pine = dressing.pine;
      this.dressing.push(this._add(pineGeometry(THREE, Math.max(.1, finite(pine.heightM, 45)), Math.max(.1, finite(pine.widthM, 18))),
        'pine', pine.positionM, { grounded: true }));
    }
    this.contact = this._add(contactGeometry(THREE, layout.heights.broshi * .57, layout.heights.broshi * .12),
      'rock', layout.anchors.broshi, { grounded: true, shadow: true });
    if (this.gpuBytes > COVE_GPU_BYTES) { this.dispose(); throw new RangeError('Cove geometry exceeds its reserved GPU budget'); }
  }

  _add(geometry, palette, root, { grounded = false, size = 1, shadow = false } = {}) {
    const THREE = this.THREE;
    if (!this.geometries.has(geometry)) { this.geometries.add(geometry); this.gpuBytes += geometryBytes(geometry); }
    const colors = PALETTE[palette];
    const uniforms = { ...this._shared,
      uRoot: { value: new THREE.Vector3(...root) },
      uRight: { value: new THREE.Vector3(...this.layout.right) }, uForward: { value: new THREE.Vector3(...this.layout.forward) },
      uUp: { value: new THREE.Vector3(...(this.layout.up || [0, 1, 0])) }, uOrbitRadius: { value: 0 },
      uSize: { value: size }, uLean: { value: 0 }, uTurn: { value: 0 }, uGrounded: { value: grounded ? 1 : 0 },
      uHead: { value: 0 }, uTail: { value: 0 }, uJaw: { value: 0 }, uTailPivot: { value: new THREE.Vector2(-26 / 34, 16 / 34) },
      uWalking: { value: 0 }, uFrontFoot: { value: new THREE.Vector3() }, uRearFoot: { value: new THREE.Vector3() },
      uBodyLift: { value: 0 }, uStroke: { value: 0 }, uShadowOpacity: { value: 1 },
      uJawPivot: { value: new THREE.Vector2(10 / 34, 13 / 34) }, uGlow: { value: 0 }, uShadow: { value: shadow ? 1 : 0 },
      uBodyColor: { value: new THREE.Color(colors[0]) }, uEdgeColor: { value: new THREE.Color(colors[1]) },
    };
    const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms,
      vertexShader: COVE_VERT, fragmentShader: COVE_FRAG, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, transparent: shadow });
    this.materials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = shadow ? 1 : 2;
    this.group.add(mesh);
    const record = { mesh, uniforms, depth: [] };
    if (!shadow) {
      const depthMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms,
        vertexShader: COVE_VERT, fragmentShader: COVE_DEPTH_FRAG, side: THREE.DoubleSide,
        colorWrite: false, depthTest: true, depthWrite: true, depthFunc: THREE.LessEqualDepth });
      this.materials.add(depthMaterial);
      for (const group of [this.depthGroup, this.bandDepthGroup]) {
        const depth = new THREE.Mesh(geometry, depthMaterial);
        depth.frustumCulled = false;
        group.add(depth);
        record.depth.push(depth);
      }
    }
    return record;
  }

  _visible(record, visible) {
    record.mesh.visible = visible;
    for (const depth of record.depth) depth.visible = visible;
  }

  _basis(record, pose) {
    for (const [field, fallback] of [['right', this.layout.right], ['up', this.layout.up || [0, 1, 0]],
      ['forward', this.layout.forward]]) {
      const value = pose[field];
      record.uniforms[`u${field[0].toUpperCase()}${field.slice(1)}`].value.set(...(
        value?.length === 3 && value.every(Number.isFinite) ? value : fallback));
    }
    record.uniforms.uOrbitRadius.value = Math.max(0, finite(pose.orbitRadiusM));
  }

  update(pose) {
    if (this.disposed) return;
    this.snapshot = pose;
    for (const id of ['midio', 'broshi', 'midasus']) {
      const record = this.actors[id], actor = pose?.actors?.find(a => a.id === id);
      const present = !!actor && actor.positionM?.length === 3 && actor.positionM.every(Number.isFinite);
      this._visible(record, present);
      if (!present) {
        for (const baby of record.babies) this._visible(baby, false);
        continue;
      }
      const u = record.uniforms;
      u.uRoot.value.set(...actor.positionM);
      this._basis(record, actor);
      u.uSize.value = Math.max(.1, finite(actor.heightM, this.layout.heights[id]));
      u.uLean.value = finite(actor.leanRad);
      u.uTurn.value = finite(actor.turnRad);
      u.uHead.value = finite(actor.headAngle);
      u.uTail.value = finite(actor.tailAngle);
      u.uJaw.value = unit(actor.jawOpen);
      u.uStroke.value = finite(actor.strokeAngle);
      u.uGlow.value = unit(actor.glow);
      u.uWalking.value = id === 'broshi' && actor.footOffsetsM?.length === 2 ? 1 : 0;
      for (const [index, name] of ['uFrontFoot', 'uRearFoot'].entries()) {
        const foot = actor.footOffsetsM?.[index];
        u[name].value.set(finite(foot?.[0]), finite(foot?.[1]), finite(foot?.[2]));
      }
      u.uBodyLift.value = finite(actor.bodyLiftM);
      record.babies.forEach((baby, i) => {
        const at = actor.babies?.[i];
        const valid = at?.positionM?.length === 3 && at.positionM.every(Number.isFinite);
        this._visible(baby, !!valid);
        if (!valid) return;
        baby.uniforms.uRoot.value.set(...at.positionM);
        this._basis(baby, at);
        baby.uniforms.uSize.value = Math.max(.1, finite(at.heightM, 3));
        baby.uniforms.uLean.value = finite(at.rotationRad);
        baby.uniforms.uGlow.value = unit(actor.glow) * .7;
      });
    }
    const walker = this.actors.broshi;
    this._visible(this.contact, walker.mesh.visible);
    if (walker.mesh.visible) {
      const actor = pose.actors.find(actor => actor.id === 'broshi');
      this._basis(this.contact, actor);
      this.contact.uniforms.uRoot.value.copy(walker.uniforms.uRoot.value);
      this.contact.uniforms.uTurn.value = walker.uniforms.uTurn.value;
      this.contact.uniforms.uSize.value = walker.uniforms.uSize.value / this.layout.heights.broshi
        * Math.max(.1, finite(actor.contactScale, 1));
      this.contact.uniforms.uShadowOpacity.value = unit(finite(actor.contactOpacity, 1));
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const group of [this.group, this.depthGroup, this.bandDepthGroup]) {
      group.removeFromParent();
      group.clear();
    }
    this.geometries.clear(); this.materials.clear(); this.snapshot = null;
  }
}
