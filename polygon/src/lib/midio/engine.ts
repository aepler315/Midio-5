import { createAudio, landThump, pollAudio, startTransport, type AudioEngine, grabTick, setMuted, unlockAudio } from "./audio";
import { createConductor, launchJump, stepConductor, type ConductorState } from "./conductor";
import { computeIris, drawScene } from "./draw";
import { applyApotheosis, createWorld, nearestParticle, physicsStep, placeParticles, type PhysicsWorld } from "./physics";
import { buildMidioMesh } from "./tessellate";
import { PHYSICS_DT, type PhysicsMode } from "./types";
import { useMidioStore } from "./store";

export interface MidioEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  world: PhysicsWorld;
  conductor: ConductorState;
  audio: AudioEngine | null;
  mode: PhysicsMode;
  running: boolean;
  started: boolean;
  pointer: { x: number; y: number; down: boolean; grab: number };
  reduced: boolean;
  acc: number;
  last: number;
  raf: number;
  unbind: () => void;
  groundY: number;
  lastApo: number;
  hudClock: number;
  frames: number;
  fps: number;
  fpsLast: number;
  wasAirborne: boolean;
  placed: boolean;
}

export let liveEngine: MidioEngine | null = null;

export function attachEngine(canvas: HTMLCanvasElement): MidioEngine {
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas 2D unavailable");
  const mesh = buildMidioMesh(0x51d10);
  const world = createWorld(mesh);
  const conductor = createConductor();
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const engine: MidioEngine = {
    canvas,
    ctx,
    world,
    conductor,
    audio: null,
    mode: "crystal",
    running: true,
    started: false,
    pointer: { x: 0, y: 0, down: false, grab: -1 },
    reduced,
    acc: 0,
    last: performance.now(),
    raf: 0,
    unbind: () => {},
    groundY: 0,
    lastApo: 0,
    hudClock: 0,
    frames: 0,
    fps: 60,
    fpsLast: performance.now(),
    wasAirborne: false,
    placed: false,
  };
  liveEngine = engine;

  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    engine.pointer.x = e.clientX - r.left;
    engine.pointer.y = e.clientY - r.top;
    if (e.type === "pointerdown") {
      canvas.setPointerCapture(e.pointerId);
      engine.pointer.down = true;
      const idx = nearestParticle(engine.world, engine.pointer.x, engine.pointer.y, 52);
      engine.pointer.grab = idx;
      if (idx < 0 && engine.started) launchJump(engine.conductor, engine.conductor.timeMs, engine.conductor.energy);
      if (idx >= 0 && engine.audio) grabTick(engine.audio);
    } else if (e.type === "pointerup" || e.type === "pointercancel") {
      engine.pointer.down = false;
      engine.pointer.grab = -1;
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (engine.started) launchJump(engine.conductor, engine.conductor.timeMs, engine.conductor.energy);
    } else if (e.key === "1") setMode(engine, "crystal");
    else if (e.key === "2") setMode(engine, "visco");
    else if (e.key === "3") setMode(engine, "shatter");
    else if (e.key === "4") setMode(engine, "swarm");
    else if (e.key === "m" || e.key === "M") toggleMute(engine);
    else if (e.key === "i" || e.key === "I") useMidioStore.getState().toggleSystems();
  };

  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerup", onPointer);
  canvas.addEventListener("pointercancel", onPointer);
  window.addEventListener("keydown", onKey);
  const vis = () => {
    if (document.visibilityState === "visible" && engine.audio) unlockAudio(engine.audio);
  };
  document.addEventListener("visibilitychange", vis);

  engine.unbind = () => {
    engine.running = false;
    cancelAnimationFrame(engine.raf);
    canvas.removeEventListener("pointerdown", onPointer);
    canvas.removeEventListener("pointermove", onPointer);
    canvas.removeEventListener("pointerup", onPointer);
    canvas.removeEventListener("pointercancel", onPointer);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", vis);
    void engine.audio?.ctx.close();
    if (liveEngine === engine) liveEngine = null;
  };

  const loop = (now: number) => {
    if (!engine.running) return;
    engine.raf = requestAnimationFrame(loop);
    let dt = (now - engine.last) / 1000;
    engine.last = now;
    if (dt > 0.1) dt = 0.1;
    tick(engine, dt, now);
  };
  engine.raf = requestAnimationFrame(loop);
  return engine;
}

export function startEngine(engine: MidioEngine) {
  try {
    if (!engine.audio) engine.audio = createAudio();
    startTransport(engine.audio);
  } catch {
    engine.audio = null;
  }
  engine.started = true;
  engine.conductor.timeMs = 0;
  useMidioStore.getState().setStarted(true);
}

export function setMode(engine: MidioEngine, mode: PhysicsMode) {
  engine.mode = mode;
  useMidioStore.getState().setMode(mode);
}

export function toggleMute(engine: MidioEngine) {
  if (!engine.audio) return;
  setMuted(engine.audio, !engine.audio.muted);
  useMidioStore.getState().setMuted(engine.audio.muted);
}

function resize(engine: MidioEngine) {
  const canvas = engine.canvas;
  const parent = canvas.parentElement;
  const w = parent?.clientWidth || window.innerWidth;
  const h = parent?.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.floor(w));
  const bh = Math.max(1, Math.floor(h));
  if (canvas.width !== Math.floor(bw * dpr) || canvas.height !== Math.floor(bh * dpr)) {
    canvas.width = Math.floor(bw * dpr);
    canvas.height = Math.floor(bh * dpr);
    canvas.style.width = `${bw}px`;
    canvas.style.height = `${bh}px`;
  }
  engine.groundY = bh * 0.78;
  return { w: bw, h: bh, dpr };
}

function tick(engine: MidioEngine, dt: number, now: number) {
  const { w, h, dpr } = resize(engine);
  if (engine.audio && engine.started) pollAudio(engine.audio, now);
  const energy = engine.audio?.energy ?? 0.18;
  const bpm = engine.audio?.bpm ?? 118;

  engine.acc += dt;
  let steps = 0;
  while (engine.acc >= PHYSICS_DT && steps < 8) {
    let kicked = false;
    if (engine.started && engine.audio?.started) {
      const nowA = engine.audio.ctx.currentTime;
      while (engine.audio.kickQueue.length && engine.audio.kickQueue[0]! <= nowA + 0.012) {
        engine.audio.kickQueue.shift();
        kicked = true;
      }
    } else if (engine.started) {
      const beat = 60000 / bpm;
      const cur = Math.floor(engine.conductor.timeMs / beat);
      const nxt = Math.floor((engine.conductor.timeMs + PHYSICS_DT * 1000) / beat);
      kicked = nxt > cur;
    }
    stepConductor(engine.conductor, PHYSICS_DT, kicked, engine.started ? energy : 0.14, bpm);
    if (engine.started && engine.wasAirborne && !engine.conductor.airborne && engine.audio) {
      landThump(engine.audio);
    }
    engine.wasAirborne = engine.conductor.airborne;
    const rot = (engine.conductor.leanDeg * Math.PI) / 180;
    const pose = {
      tx: w * 0.42,
      ty: engine.groundY - engine.conductor.y,
      rot,
      scaleX: engine.conductor.scaleX,
      scaleY: engine.conductor.scaleY,
      cos: Math.cos(rot),
      sin: Math.sin(rot),
      groundY: engine.groundY,
      apo: engine.conductor.apo,
    };
    if (!engine.placed) {
      placeParticles(engine.world, pose);
      engine.placed = true;
    }
    if (Math.abs(engine.conductor.apo - engine.lastApo) > 0.01) {
      applyApotheosis(engine.world, engine.conductor.apo);
      engine.lastApo = engine.conductor.apo;
    }
    physicsStep(
      engine.world,
      PHYSICS_DT,
      pose,
      engine.mode,
      energy,
      engine.conductor.timeMs / 1000,
      engine.started ? engine.conductor.kickImpulse : 0,
      engine.pointer,
    );
    engine.conductor.kickImpulse = 0;
    engine.acc -= PHYSICS_DT;
    steps++;
  }

  if (!engine.placed) {
    const rot = (engine.conductor.leanDeg * Math.PI) / 180;
    placeParticles(engine.world, {
      tx: w * 0.42,
      ty: engine.groundY - engine.conductor.y,
      rot,
      scaleX: engine.conductor.scaleX,
      scaleY: engine.conductor.scaleY,
      cos: Math.cos(rot),
      sin: Math.sin(rot),
      groundY: engine.groundY,
      apo: engine.conductor.apo,
    });
    engine.placed = true;
  }

  const iris = computeIris(engine.world, engine.pointer.x, engine.pointer.y, engine.conductor.blink);
  drawScene(engine.ctx, {
    w,
    h,
    dpr,
    tSec: now / 1000,
    world: engine.world,
    conductor: engine.conductor,
    mode: engine.mode,
    pointer: engine.pointer,
    reduced: engine.reduced,
    iris,
  });

  engine.frames++;
  if (now - engine.fpsLast > 500) {
    engine.fps = (engine.frames * 1000) / (now - engine.fpsLast);
    engine.frames = 0;
    engine.fpsLast = now;
  }
  engine.hudClock += dt;
  if (engine.hudClock > 0.12) {
    engine.hudClock = 0;
    const live = engine.world.constraints.filter((c) => !c.broken).length;
    useMidioStore.getState().patch({
      fps: Math.round(engine.fps),
      energy,
      strain: engine.world.meanStrain,
      maxStrain: engine.world.maxStrain,
      particles: engine.world.dustStart,
      constraints: live,
      fractured: engine.world.fractured,
      bpm,
      airborne: engine.conductor.airborne,
    });
  }
}
