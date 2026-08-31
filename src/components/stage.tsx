import { useLayoutEffect, useRef } from "react";
import { attachEngine, type MidioEngine } from "@/lib/midio/engine";

export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MidioEngine | null>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.current = attachEngine(canvas);
    return () => {
      engine.current?.unbind();
      engine.current = null;
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full touch-none"
      aria-label="Midio particle polygon stage"
    />
  );
}
