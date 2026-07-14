// Wireframe rest-pose meshes for the three characters. Each mesh is a flat
// {vertices:[{x,y}], edges:[[i,j],...]} in local space; vertex 0 is always
// the hub (the anchor modal vibration displaces the rim around).
//
// Design language: angular, asymmetric spectral glyphs -- irregular shard
// silhouettes with sparse internal bracing, nothing round, nothing cute.
// The characters are made of the same geometry the world runs on: sharp
// facets that catch the deformation-driven glow, sigils rather than
// mascots. MeshDrawer.js applies per-frame pose transforms and computes
// geometry-driven edge color from these rest shapes.

/** A wheel: one center vertex, n rim vertices, spokes + rim edges. */
export function radialMesh(rx, ry, n, cx = 0, cy = 0, startAngle = 0) {
  const vertices = [{ x: cx, y: cy }];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const ang = startAngle + (i / n) * Math.PI * 2;
    vertices.push({ x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry });
    edges.push([0, i + 1]);
  }
  for (let i = 0; i < n; i++) edges.push([i + 1, ((i + 1) % n) + 1]);
  return { vertices, edges };
}

/**
 * An irregular shard: hub + hand-authored rim, closed by a rim ring,
 * anchored by sparse spokes, with optional cross-braces (rim indices)
 * as internal fracture lines. The irregularity IS the character.
 */
export function shardMesh(hub, rim, { spokeEvery = 2, braces = [] } = {}) {
  const vertices = [{ ...hub }, ...rim.map((v) => ({ ...v }))];
  const edges = [];
  const n = rim.length;
  for (let i = 0; i < n; i++) edges.push([i + 1, ((i + 1) % n) + 1]);
  for (let i = 0; i < n; i += spokeEvery) edges.push([0, i + 1]);
  for (const [a, b] of braces) edges.push([a + 1, b + 1]);
  return { vertices, edges };
}

/** Merge several local meshes into one, offsetting edge indices. Returns
 * the merged mesh plus the vertex-index offset each input mesh landed at,
 * so callers can still address "my mesh's vertex 3" after merging. */
export function mergeMeshes(meshes) {
  const vertices = [];
  const edges = [];
  const offsets = [];
  for (const m of meshes) {
    offsets.push(vertices.length);
    for (const v of m.vertices) vertices.push({ x: v.x, y: v.y });
    for (const [i, j] of m.edges) edges.push([i + offsets[offsets.length - 1], j + offsets[offsets.length - 1]]);
  }
  return { mesh: { vertices, edges }, offsets };
}

// --- Midio: the Sigil. A tall asymmetric shard -- crown spike, uneven
// shoulders, two blunt ground-contact points (feet at y=0, half-width
// within his 23px collision body). The separate core (kept under the
// MIDIO_EYE name so the blink machinery still drives it) is a small
// triangle that contracts instead of blinking: the core dims. ---
export const MIDIO_BODY = shardMesh({ x: 0, y: -27 }, [
  { x: 0, y: -58 },   // crown spike
  { x: 13, y: -45 },
  { x: 23, y: -31 },
  { x: 13, y: -15 },  // pinched right waist
  { x: 9, y: 0 },     // right foot
  { x: -7, y: 0 },    // left foot
  { x: -14, y: -13 }, // pinched left waist
  { x: -22, y: -35 },
  { x: -11, y: -46 },
], { spokeEvery: 2, braces: [[1, 4], [6, 8]] });
export const MIDIO_EYE = radialMesh(5.5, 6, 3, 3, -31, -Math.PI / 2);
export const MIDIO_MESH = mergeMeshes([MIDIO_BODY, MIDIO_EYE]).mesh;

// --- Apotheosis: Midio's earned transformation (spec: charge earned by
// clean play unfolds his 9-rim shard into an 18-rim glyph for 8s). Both
// meshes below share the same hub, vertex count, and edge topology --
// only positions differ -- so the transform is a pure per-vertex lerp
// between them; MeshDrawer's existing deform-from-rest coloring (rest
// lengths fixed to the FOLDED state) turns the lengthening rim edges into
// the "unfolding" glow for free. The FOLDED mesh's even rim vertices sit
// exactly on MIDIO_BODY's original 9 rim points -- APOTHEOSIS_INDEX_MAP
// records that correspondence for tests.
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

const _apoHub = { ...MIDIO_BODY.vertices[0] };
const _bodyRim = MIDIO_BODY.vertices.slice(1); // the original 9 rim vertices
const _foldedRim = [];
for (let k = 0; k < _bodyRim.length; k++) {
  _foldedRim.push({ ..._bodyRim[k] });
  _foldedRim.push(midpoint(_bodyRim[k], _bodyRim[(k + 1) % _bodyRim.length]));
}
const _apoBraces = [[2, 8], [12, 16]]; // original [[1,4],[6,8]] rim-indices, doubled
export const MIDIO_APOTHEOSIS_FOLDED = shardMesh(_apoHub, _foldedRim, {
  spokeEvery: 2, braces: _apoBraces,
});

const _unfoldedRim = _foldedRim.map((v, i) => {
  const dx = v.x - _apoHub.x, dy = v.y - _apoHub.y;
  const r = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  // Original rim vertices (even indices) stretch modestly; the new
  // midpoint vertices (odd indices) spike out much further -- the bloom
  // that reads as "unfolding" rather than just "growing".
  const reach = i % 2 === 1 ? r * 2.05 : r * 1.35;
  return { x: _apoHub.x + Math.cos(ang) * reach, y: _apoHub.y + Math.sin(ang) * reach };
});
export const MIDIO_APOTHEOSIS_UNFOLDED = shardMesh(_apoHub, _unfoldedRim, {
  spokeEvery: 2, braces: _apoBraces,
});

// index[k] = the FOLDED/UNFOLDED vertex index that corresponds to
// MIDIO_BODY's rim vertex k (MIDIO_BODY.vertices[k + 1]).
export const APOTHEOSIS_INDEX_MAP = Array.from({ length: _bodyRim.length }, (_, k) => 2 * k + 1);

// --- Broshi: the Dart. A low predatory chassis with a serrated dorsal
// ridge (deep notches between three spine spikes), a wedge head that
// still neck-bobs, a thin mandible line driven by jawOpen, and a long
// whip tail (2 vertices: base + tip, swayed by rotating the tip). ---
export const BROSHI_BODY = shardMesh({ x: 0, y: -14 }, [
  { x: -26, y: -9 },  // rear haunch
  { x: -19, y: -25 }, // spine spike 1
  { x: -13, y: -18 }, // notch
  { x: -6, y: -30 },  // spine spike 2
  { x: 1, y: -21 },   // notch
  { x: 7, y: -27 },   // spine spike 3
  { x: 15, y: -16 },  // shoulder, into the head
  { x: 12, y: -4 },
  { x: 2, y: -1 },    // front foot
  { x: -14, y: -2 },  // rear foot
], { spokeEvery: 3, braces: [[1, 3], [3, 5]] });
export const BROSHI_HEAD = shardMesh({ x: 14, y: -19 }, [
  { x: 27, y: -16 },  // snout tip
  { x: 21, y: -25 },  // crest
  { x: 10, y: -24 },
  { x: 7, y: -17 },
  { x: 12, y: -12 },
], { spokeEvery: 2 });
// Jaw: two free vertices (upper anchor, moving mandible tip) driven by jawOpen.
export const BROSHI_JAW = {
  vertices: [{ x: 11, y: -14 }, { x: 25, y: -12 }],
  edges: [[0, 1]],
};
export const BROSHI_EYE = radialMesh(2.2, 2.2, 3, 15, -22, -Math.PI / 2);
// Tail: anchor near the back of the body, tip trailing behind -- swayed
// in place (see Broshi's calm behaviors) by rotating vertex 1 about vertex 0.
export const BROSHI_TAIL = { vertices: [{ x: -25, y: -7 }, { x: -47, y: -1 }], edges: [[0, 1]] };

// --- Midasus: a hexagram -- two interlocked triangles about the hub with
// a single vertical axis spoke pair. An arcane instrument, not a gem. ---
export const MIDASUS_HEX_R = 8.5;
const HEX_R = MIDASUS_HEX_R;
const tri = (offsetDeg) => [0, 1, 2].map((i) => {
  const a = ((offsetDeg + i * 120) * Math.PI) / 180;
  return { x: Math.cos(a) * HEX_R, y: Math.sin(a) * HEX_R };
});
const [a0, a1, a2] = tri(-90);
const [b0, b1, b2] = tri(90);
export const MIDASUS_MESH = {
  vertices: [{ x: 0, y: 0 }, a0, a1, a2, b0, b1, b2],
  edges: [
    [1, 2], [2, 3], [3, 1], // upward triangle
    [4, 5], [5, 6], [6, 4], // downward triangle
    [0, 1], [0, 4],         // vertical axis
  ],
};
