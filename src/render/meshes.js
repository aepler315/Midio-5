// Low-poly wireframe rest-pose meshes for the three characters (follow-up
// item 1). Each mesh is a flat {vertices:[{x,y}], edges:[[i,j],...]} in
// local, untransformed space, generated parametrically rather than
// hand-authored so the "low-poly" silhouette stays easy to retune.
// MeshDrawer.js applies per-frame pose transforms and computes geometry-
// driven edge color from these rest shapes.

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

// --- Midio: rounded body wheel + a small eye wheel ---
const MIDIO_BODY = radialMesh(23, 27, 10, 0, -27);
const MIDIO_EYE = radialMesh(5, 6, 5, 10, -31);
export const MIDIO_MESH = mergeMeshes([MIDIO_BODY, MIDIO_EYE]).mesh;

// --- Broshi: body wheel + head wheel (parts kept separate so the head can
// rotate independently for the neck-bob) + a 2-vertex jaw wedge ---
export const BROSHI_BODY = radialMesh(24, 16, 8, 0, -14);
export const BROSHI_HEAD = radialMesh(10, 8, 6, 14, -20);
// Jaw: two free vertices (upper lip anchor, moving jaw tip) driven by jawOpen.
export const BROSHI_JAW = {
  vertices: [{ x: 10, y: -16 }, { x: 22, y: -16 }],
  edges: [[0, 1]],
};
export const BROSHI_EYE = radialMesh(2.4, 2.4, 5, 16, -23);

// --- Midasus: a small diamond core; particle trail carries most of her presence ---
export const MIDASUS_MESH = radialMesh(7, 7, 6, 0, 0);
