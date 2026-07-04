// Static wireframe meshes for the three characters (item 1). Each mesh is a
// small vertex/edge list — framework-free, no sprite assets. Vertices are in
// local character space (y up is negative, as Canvas 2D draws). Edges are
// indices into the vertex array. Some vertices are grouped for sub-mesh
// transforms (jaw hinge, head/neck, eye ring) applied by MeshDrawer.

// Midio: rounded body silhouette (~20 verts) + eye ring.
const MIDIO_VERTS = [
  // lower body, clockwise from bottom-left
  { x: -23, y: -8 }, { x: -18, y: -2 }, { x: -10, y: 0 }, { x: 0, y: 1 },
  { x: 10, y: 0 }, { x: 18, y: -2 }, { x: 23, y: -8 }, { x: 24, y: -18 },
  { x: 20, y: -28 }, { x: 14, y: -38 }, { x: 8, y: -46 }, { x: 0, y: -54 },
  { x: -8, y: -46 }, { x: -14, y: -38 }, { x: -20, y: -28 }, { x: -24, y: -18 },
  // eye ring
  { x: 5, y: -36 }, { x: 11, y: -38 }, { x: 15, y: -34 }, { x: 13, y: -28 },
  { x: 7, y: -26 }, { x: 3, y: -30 },
];
const MIDIO_EDGES = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],
  [11,12],[12,13],[13,14],[14,15],[15,0], // body ring
  [16,17],[17,18],[18,19],[19,20],[20,21],[21,16], // eye ring
  [11,16], // eye connector
];
export const MIDIO_MESH = {
  vertices: MIDIO_VERTS,
  edges: MIDIO_EDGES,
  baseHue: 48, // warm yellow
  fillLoops: [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // body silhouette
    [16, 17, 18, 19, 20, 21], // eye ring
  ],
};

// Broshi: body (~14), head (~8), jaw as hinged sub-mesh (~6), tail (~3).
const BROSHI_VERTS = [
  // body, centered at (0,-14)
  { x: -24, y: -6 }, { x: -20, y: -2 }, { x: -10, y: 2 }, { x: 0, y: 4 },
  { x: 12, y: 2 }, { x: 20, y: -2 }, { x: 24, y: -8 }, { x: 20, y: -18 },
  { x: 12, y: -24 }, { x: 0, y: -28 }, { x: -12, y: -26 }, { x: -20, y: -20 },
  // neck
  { x: 12, y: -24 }, { x: 16, y: -28 },
  // head (group: 'head', pivot around neck 12/13)
  { x: 14, y: -28 }, { x: 22, y: -30 }, { x: 26, y: -24 }, { x: 24, y: -18 },
  { x: 16, y: -16 }, { x: 12, y: -20 },
  // jaw (group: 'jaw', hinge = vertex 18)
  { x: 18, y: -18 }, { x: 26, y: -18 }, { x: 30, y: -10 }, { x: 26, y: -6 },
  { x: 18, y: -8 }, { x: 14, y: -12 },
  // tail (grouped for lazy sway when calm)
  { x: -24, y: -12, group: 'tail' }, { x: -40, y: -22, group: 'tail' }, { x: -54, y: -12, group: 'tail' },
  // eye
  { x: 20, y: -22, group: 'head' },
];
const BROSHI_EDGES = [
  // body
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,0],
  [12,13], // neck
  // head
  [14,15],[15,16],[16,17],[17,18],[18,19],[19,14],
  // jaw
  [20,21],[21,22],[22,23],[23,24],[24,25],[25,20],
  // mouth hinge seam
  [17,20],[18,25],
  // tail
  [11,26],[26,27],[27,28],
  // eye
  [29,16],[29,17],
];
export const BROSHI_MESH = {
  vertices: BROSHI_VERTS,
  edges: BROSHI_EDGES,
  baseHue: 120, // green; shifted toward red by rho in drawer
  fillLoops: [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // body silhouette
    [14, 15, 16, 17, 18, 19], // head
  ],
};

// Midasus: small diamond/moth shape (~10 verts), particle-driven otherwise.
const MIDASUS_VERTS = [
  { x: 0, y: -14 }, { x: 12, y: -6 }, { x: 0, y: 12 }, { x: -12, y: -6 },
  { x: 20, y: -10 }, { x: 26, y: -20 }, { x: 22, y: -2 },
  { x: -20, y: -10 }, { x: -26, y: -20 }, { x: -22, y: -2 },
];
const MIDASUS_EDGES = [
  [0,1],[1,2],[2,3],[3,0],
  [1,4],[4,5],[5,6],[6,1],
  [3,7],[7,8],[8,9],[9,3],
  [0,4],[0,7],
];
export const MIDASUS_MESH = {
  vertices: MIDASUS_VERTS,
  edges: MIDASUS_EDGES,
  baseHue: 200, // initial fairy blue, replaced by live hue
  fillLoops: [[0, 1, 2, 3]], // wing/body diamond
};

Object.freeze(MIDIO_MESH); Object.freeze(MIDIO_MESH.vertices); Object.freeze(MIDIO_MESH.edges);
Object.freeze(BROSHI_MESH); Object.freeze(BROSHI_MESH.vertices); Object.freeze(BROSHI_MESH.edges);
Object.freeze(MIDASUS_MESH); Object.freeze(MIDASUS_MESH.vertices); Object.freeze(MIDASUS_MESH.edges);