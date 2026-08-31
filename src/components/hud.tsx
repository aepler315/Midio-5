import { liveEngine, setAbstraction, setMode, startEngine, toggleMute } from "@/lib/midio/engine";
import { useMidioStore } from "@/lib/midio/store";
import { ABSTRACTIONS, type PhysicsMode } from "@/lib/midio/types";

const MODES: { id: PhysicsMode; label: string; key: string }[] = [
  { id: "crystal", label: "Crystal", key: "1" },
  { id: "visco", label: "Visco", key: "2" },
  { id: "shatter", label: "Shatter", key: "3" },
  { id: "swarm", label: "Swarm", key: "4" },
];

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-16 flex-col">
      <span className="font-mono text-[0.65rem] tracking-[0.16em] text-subtle uppercase">{k}</span>
      <span className="font-mono text-sm tabular-nums text-fg">{v}</span>
    </div>
  );
}

export function Hud() {
  const started = useMidioStore((s) => s.started);
  const mode = useMidioStore((s) => s.mode);
  const abstraction = useMidioStore((s) => s.abstraction);
  const fps = useMidioStore((s) => s.fps);
  const energy = useMidioStore((s) => s.energy);
  const strain = useMidioStore((s) => s.strain);
  const particles = useMidioStore((s) => s.particles);
  const constraints = useMidioStore((s) => s.constraints);
  const fractured = useMidioStore((s) => s.fractured);
  const bpm = useMidioStore((s) => s.bpm);
  const muted = useMidioStore((s) => s.muted);
  const airborne = useMidioStore((s) => s.airborne);
  const toggleSystems = useMidioStore((s) => s.toggleSystems);

  return (
    <>
      <TitleGate started={started} />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold tracking-tight text-fg md:text-xl">Midio</p>
            <p className="font-mono text-[0.65rem] tracking-[0.22em] text-muted uppercase">
              {ABSTRACTIONS.find((a) => a.id === abstraction)?.label} · particle polygon
            </p>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSystems}
              className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-fg transition-opacity duration-150 hover:opacity-80"
            >
              Systems
            </button>
            <button
              type="button"
              onClick={() => {
                if (liveEngine) toggleMute(liveEngine);
              }}
              className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-fg transition-opacity duration-150 hover:opacity-80"
            >
              {muted ? "Sound off" : "Sound on"}
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border bg-surface/80 px-4 py-3 backdrop-blur-sm">
            <Stat k="Hz" v={`${fps}`} />
            <Stat k="BPM" v={`${Math.round(bpm)}`} />
            <Stat k="Energy" v={energy.toFixed(2)} />
            <Stat k="Strain" v={strain.toFixed(3)} />
            <Stat k="Verts" v={`${particles}`} />
            <Stat k="Edges" v={`${constraints}`} />
            <Stat k="Breaks" v={`${fractured}`} />
            <Stat k="State" v={airborne ? "Apex" : "Ground"} />
          </div>

          <div className="pointer-events-auto flex flex-col gap-2">
            <div className="grid grid-cols-5 gap-1 sm:flex">
              {ABSTRACTIONS.map((a) => {
                const on = abstraction === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    title={a.blurb}
                    onClick={() => {
                      if (liveEngine) setAbstraction(liveEngine, a.id);
                    }}
                    className={
                      "min-h-11 rounded-md border px-2 py-2 text-center transition-opacity duration-150 " +
                      (on
                        ? "border-accent bg-accent text-bg"
                        : "border-border bg-surface text-fg hover:opacity-80")
                    }
                  >
                    <span className="block font-display text-xs font-semibold sm:text-sm">{a.label}</span>
                    <span className="font-mono text-[0.6rem] text-current opacity-70">Key {a.key}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
            {MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (liveEngine) setMode(liveEngine, m.id);
                  }}
                  className={
                    "min-h-11 rounded-md border px-3 py-2 text-left transition-opacity duration-150 " +
                    (on
                      ? "border-accent bg-accent text-bg"
                      : "border-border bg-surface text-fg hover:opacity-80")
                  }
                >
                  <span className="block font-display text-sm font-semibold">{m.label}</span>
                  <span className="font-mono text-[0.65rem] text-current opacity-70">Key {m.key}</span>
                </button>
              );
            })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function TitleGate({ started }: { started: boolean }) {
  if (started) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/55 px-6 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 md:p-8">
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Super Maudio World</p>
        <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight text-fg md:text-5xl">
          Midio Polygon
        </h1>
        <p className="mt-4 text-sm leading-normal text-muted">
          The crystal glyph is now a living lattice. Five geometric abstractions
          (lattice, cubist facet, Voronoi dual, constructivist beam, polar orbit)
          run over the same XPBD body. Drag a vertex. Space to jump. Q–T to recut.
        </p>
        <button
          type="button"
          onClick={() => {
            if (liveEngine) startEngine(liveEngine);
          }}
          className="mt-6 min-h-12 w-full rounded-md bg-fg px-4 py-3 font-display text-base font-semibold text-bg transition-transform duration-150 active:scale-[0.98]"
        >
          Begin performance
        </button>
        <p className="mt-3 font-mono text-[0.7rem] tracking-wide text-subtle">
          Drag · Space · 1–4 materials · Q–T abstractions
        </p>
      </div>
    </div>
  );
}
