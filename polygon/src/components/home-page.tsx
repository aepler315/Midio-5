import { Hud } from "@/components/hud";
import { Stage } from "@/components/stage";
import { SystemsPanel } from "@/components/systems-panel";

export function HomePage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <Stage />
      <Hud />
      <SystemsPanel />
    </main>
  );
}
