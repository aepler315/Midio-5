import { createFileRoute } from "@tanstack/react-router";
import { Hud } from "@/components/hud";
import { Stage } from "@/components/stage";
import { SystemsPanel } from "@/components/systems-panel";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <Stage />
      <Hud />
      <SystemsPanel />
    </main>
  );
}
