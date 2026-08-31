import { useMidioStore } from "@/lib/midio/store";

const SECTIONS = [
  {
    title: "1. Tessellated hull",
    body: "Midio is a crystal figure — faceted head, hanging arm-shards, two planted feet — tessellated into a particle lattice. The hull is Poisson-sampled and Delaunay-triangulated so the body is a polygonal field (hull, spokes, hexagram core), not a sprite.",
  },
  {
    title: "2. XPBD solver",
    body: "A custom extended position-based dynamics loop runs at 120 Hz with eight iterations. Distance, hull, spoke, and core constraints each have their own compliance. Triangle area constraints keep facets from collapsing. Verlet integration with clamped delta keeps the sim stable.",
  },
  {
    title: "3. Shape matching",
    body: "Müller-style polar decomposition pulls the live cloud toward a posed rest shape (jump arc, lean, squash). The conductor still lands jumps on the beat; the mesh is what has inertia, strain, and fracture.",
  },
  {
    title: "4. Four material laws",
    body: "Crystal is near-rigid. Viscoelastic drops stiffness so kicks wobble through the lattice. Shatter breaks strained edges into debris (spatial-hash collisions) and reassembles. Swarm weakens constraints and adds curl-noise flocking into the silhouette.",
  },
  {
    title: "5. Music coupling",
    body: "A scheduled Web Audio transport (kick, hat, bass, pad) is the clock. Onsets launch the three-phase jump curve, radial impulses, beat flash, and trauma-squared camera shake. High energy unfolds the hull toward apotheosis.",
  },
];

export function SystemsPanel() {
  const open = useMidioStore((s) => s.showSystems);
  const toggle = useMidioStore((s) => s.toggleSystems);
  if (!open) return null;

  return (
    <aside
      className="pointer-events-auto absolute inset-x-3 top-3 z-20 mx-auto max-h-[min(78vh,720px)] w-[min(100%,34rem)] overflow-y-auto rounded-xl border border-border bg-surface/92 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-sm md:left-auto md:right-4 md:top-20 md:w-[22.5rem]"
      aria-label="Physics systems"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Plan</p>
          <h2 className="font-display mt-1 text-xl font-semibold tracking-tight">Particle polygon</h2>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="rounded-sm border border-border px-2 py-1 font-mono text-xs text-muted transition-opacity duration-[var(--motion-quick,150ms)] hover:text-fg"
        >
          Close
        </button>
      </div>
      <ol className="flex flex-col gap-4">
        {SECTIONS.map((s) => (
          <li key={s.title}>
            <h3 className="font-display text-sm font-semibold text-fg">{s.title}</h3>
            <p className="mt-1 text-sm leading-normal text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
