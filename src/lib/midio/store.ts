import { create } from "zustand";
import type { Abstraction, PhysicsMode } from "./types";

interface HudState {
  started: boolean;
  muted: boolean;
  showSystems: boolean;
  mode: PhysicsMode;
  abstraction: Abstraction;
  fps: number;
  energy: number;
  strain: number;
  maxStrain: number;
  particles: number;
  constraints: number;
  fractured: number;
  bpm: number;
  airborne: boolean;
  setStarted: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setMode: (v: PhysicsMode) => void;
  setAbstraction: (v: Abstraction) => void;
  toggleSystems: () => void;
  patch: (p: Partial<HudState>) => void;
}

export const useMidioStore = create<HudState>((set) => ({
  started: false,
  muted: false,
  showSystems: false,
  mode: "crystal",
  abstraction: "lattice",
  fps: 60,
  energy: 0,
  strain: 0,
  maxStrain: 0,
  particles: 0,
  constraints: 0,
  fractured: 0,
  bpm: 118,
  airborne: false,
  setStarted: (started) => set({ started }),
  setMuted: (muted) => set({ muted }),
  setMode: (mode) => set({ mode }),
  setAbstraction: (abstraction) => set({ abstraction }),
  toggleSystems: () => set((s) => ({ showSystems: !s.showSystems })),
  patch: (p) => set(p),
}));
