// WebGL path factory + resolve mode (MIDI restore + feature).
// No real WebGL in Node — we assert Canvas-safe construction and fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRendererMode, createRenderer, WebGLRenderer } from '../src/render/WebGLRenderer.js';
import { Renderer, hitTestComposerStrip } from '../src/render/Renderer.js';
import * as rendererModule from '../src/render/Renderer.js';
import fs from 'node:fs';
import vm from 'node:vm';

test('resolveRendererMode defaults to canvas', () => {
  assert.equal(resolveRendererMode(''), 'canvas');
  assert.equal(resolveRendererMode('?foo=1'), 'canvas');
  assert.equal(resolveRendererMode('renderer=canvas'), 'canvas');
});

test('resolveRendererMode accepts ?renderer=webgl (case-insensitive)', () => {
  assert.equal(resolveRendererMode('?renderer=webgl'), 'webgl');
  assert.equal(resolveRendererMode('?renderer=WebGL&x=1'), 'webgl');
  assert.equal(resolveRendererMode('renderer=webgl'), 'webgl');
});

test('resolveRendererMode rejects unknown modes', () => {
  assert.equal(resolveRendererMode('?renderer=vulkan'), 'canvas');
  assert.equal(resolveRendererMode('?renderer='), 'canvas');
});

// Minimal canvas stub: createRenderer(canvas) must not throw in Node and
// must never call getContext('webgl') on the stage canvas.
function makeCanvasStub() {
  const calls = [];
  return {
    width: 1280,
    height: 720,
    parentElement: null,
    style: {},
    getContext(type, attrs) {
      calls.push({ type, attrs });
      if (type === '2d') {
        // Bare-minimum 2d context so Renderer constructor can run.
        return {
          canvas: this,
          save() {}, restore() {}, clearRect() {}, translate() {}, scale() {},
          rotate() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
          stroke() {}, fill() {}, arc() {}, createLinearGradient() {
            return { addColorStop() {} };
          },
          set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
          set globalAlpha(_) {}, set globalCompositeOperation(_) {},
          set lineCap(_) {}, set font(_) {}, set textAlign(_) {},
          fillText() {}, strokeText() {}, drawImage() {},
          roundRect() {}, closePath() {}, quadraticCurveTo() {},
          bezierCurveTo() {}, rect() {}, clip() {}, measureText() {
            return { width: 0 };
          },
        };
      }
      return null;
    },
    _calls: calls,
  };
}

test('createRenderer(canvas, canvas) returns stock Renderer and only uses 2d', () => {
  const canvas = makeCanvasStub();
  const r = createRenderer(canvas, 'canvas');
  assert.ok(r instanceof Renderer);
  assert.ok(canvas._calls.every((c) => c.type === '2d'));
  assert.ok(!canvas._calls.some((c) => String(c.type).startsWith('webgl')));
});

test('createRenderer(canvas, webgl) never steals WebGL context from stage canvas', () => {
  const canvas = makeCanvasStub();
  const r = createRenderer(canvas, 'webgl');
  assert.ok(r instanceof WebGLRenderer);
  // Stage canvas must only ever see '2d' (from the inner Canvas Renderer).
  assert.ok(canvas._calls.every((c) => c.type === '2d'),
    `stage context calls were ${JSON.stringify(canvas._calls)}`);
  // Without document/parent, backend falls back safely.
  assert.ok(r.backend === 'canvas-fallback' || r.backend === 'webgl' || r.backend === 'canvas');
  assert.equal(typeof r.draw, 'function');
  assert.equal(typeof r.dispose, 'function');
  r.dispose();
});

test('hudInFrame defaults off, and reaches the compositor through the WebGL wrapper', () => {
  // Bulk export switches the seekbar strip off; on the WebGL path the strip
  // is drawn by the inner canvas Renderer, so a flag that only landed on the
  // wrapper would silently leave it burned into every exported frame.
  const plain = createRenderer(makeCanvasStub(), 'canvas');
  assert.equal(plain.hudInFrame, false);
  plain.hudInFrame = false;
  assert.equal(plain.hudInFrame, false);

  const wrapped = createRenderer(makeCanvasStub(), 'webgl');
  assert.equal(wrapped.hudInFrame, false);
  wrapped.hudInFrame = false;
  assert.equal(wrapped.canvasRenderer.hudInFrame, false);
});

test('hidden seek strip rejects pointer hits and debug visibility re-enables real hit testing', () => {
  for (const mode of ['canvas', 'webgl']) {
    const renderer = createRenderer(makeCanvasStub(), mode);
    const compositor = renderer.canvasRenderer || renderer;
    const hit = { type: 'strip', tMs: 1234 };
    let calls = 0;
    compositor.composer = { hitTest: () => { calls++; return hit; } };
    renderer.hudInFrame = false;
    assert.equal(hitTestComposerStrip(renderer, 600, 680, { width: 1280, height: 720 }), null);
    assert.equal(calls, 0, 'invisible targets never capture beat taps');
    renderer.hudInFrame = true;
    assert.equal(hitTestComposerStrip(renderer, 600, 680, { width: 1280, height: 720 }), hit);
    assert.equal(calls, 1);
  }
});

test('seek reconstruction preserves explicitly visible debug strip and selected section', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function seekSong(ms) {');
  const seekSource = source.slice(start, source.indexOf('/** The player', start));
  for (const mode of ['canvas', 'webgl']) {
    const state = { running: true, paused: false,
      sim: { songSeed: 7, conductor: { durationMs: 60000 }, showSectionLabels: true },
      audioEngine: { nowMs: 1000 }, lastTimelineData: {}, lastAudioBuffer: null,
      renderer: createRenderer(makeCanvasStub(), mode), updatePauseButtonUI() {} };
    const old = state.renderer.canvasRenderer || state.renderer;
    old.hudInFrame = true; old.composer = { selectedSection: 2 };
    state.startTimeline = () => {
      state.sim = { songSeed: 7, conductor: { durationMs: 60000 }, showSectionLabels: false };
      state.renderer = createRenderer(makeCanvasStub(), mode);
      state.renderer.draw = () => {
        const r = state.renderer.canvasRenderer || state.renderer;
        if (r.hudInFrame) r.composer = { selectedSection: -1 };
      };
    };
    vm.runInNewContext(`${seekSource}\nseekSong(2000);`, state);
    const fresh = state.renderer.canvasRenderer || state.renderer;
    assert.equal(fresh.hudInFrame, true);
    assert.equal(fresh.composer.selectedSection, 2);
    assert.equal(state.sim.showSectionLabels, true);
  }
});

test('glacial scenic flight reduces frame shake while retaining cast visibility zoom', () => {
  assert.equal(typeof rendererModule.presentationCamera, 'function');
  const camera = { shakeX: 20, shakeY: -10, roll: .02, zoom: .8 };
  const ordinary = { enabled: true, captionViewFor: () => ({ id: 'ordinary' }) };
  const glacier = { enabled: true, captionViewFor: () => ({ id: 'pilot', glacier: {} }) };
  const biomes = { currentBlend: { from: 'TAIGA', to: 'TAIGA', t: 1 } };
  assert.equal(rendererModule.presentationCamera(camera, ordinary, biomes), camera);
  const damped = rendererModule.presentationCamera(camera, glacier, biomes);
  assert.ok(Math.abs(damped.shakeX) <= 2 && Math.abs(damped.shakeY) <= 1);
  assert.ok(Math.abs(damped.roll) <= .002);
  assert.equal(damped.zoom, .8, 'character-fit zoom keeps its actual purpose');
  assert.equal(camera.shakeX, 20, 'does not mutate simulation camera');
  assert.deepEqual(rendererModule.presentationCamera(camera, glacier, biomes), damped, 'pure across redraw/seek');
});

test('Range views drop beat sway and calm drift and keep only a trace of impact shake', () => {
  const camera = { shakeX: 14, shakeY: 9, ambientX: 4, ambientY: 9, roll: .02, zoom: 1 };
  const biomes = { currentBlend: { from: 'TAIGA', to: 'TAIGA', t: 1 } };
  const range = { enabled: true, active: true, arrival: 1, captionViewFor: () => ({}) };
  const out = rendererModule.presentationCamera(camera, range, biomes);
  assert.ok(Math.abs(out.shakeX - 10 * .08) < 1e-9 && Math.abs(out.shakeY) < 1e-9);
  assert.ok(Math.abs(out.roll) <= .002);
  const arriving = rendererModule.presentationCamera(camera, { ...range, arrival: 0 }, biomes);
  assert.equal(arriving, camera, 'nothing changes before the view arrives');
  assert.equal(rendererModule.presentationCamera(camera, { ...range, active: false }, biomes), camera);
});

test('circular Journey leaves framing to its radial camera across legacy spring histories',()=>{
  const presentation={enabled:true,active:true,journey:true,arrival:1,
    captionViewFor:()=>({id:'moonlit-journey'}),scene:{isReady:()=>true}};
  for(const zoom of [.63,1,1.25]){
    const camera={zoom,shakeX:14,shakeY:-9,ambientX:4,ambientY:3,roll:.03};
    const actual=rendererModule.presentationCamera(camera,presentation,{});
    assert.equal(actual.zoom,1);
    assert.equal(actual.shakeX,0);assert.equal(actual.shakeY,0);assert.equal(actual.roll,0);
    assert.equal(camera.zoom,zoom,'simulation remains available for other worlds');
  }
});

test('Journey normalizes its first ready frame and preserves unavailable-scene fallback',()=>{
  const camera={zoom:.63,shakeX:14,shakeY:-9,roll:.03};
  const presentation={enabled:true,active:false,journey:true,arrival:1,
    captionViewFor:()=>({id:'moonlit-journey'}),scene:{isReady:()=>true}};
  const first=rendererModule.presentationCamera(camera,presentation,{});
  assert.equal(first.zoom,1,'readiness is available before beginScenic sets active');
  presentation.active=true;
  assert.deepEqual(rendererModule.presentationCamera(camera,presentation,{}),first);
  presentation.active=false;presentation.scene.isReady=()=>false;
  assert.equal(rendererModule.presentationCamera(camera,presentation,{}),camera);
});

test('glacial foreground placement moves support, cast and pool together while ordinary scenes hold', () => {
  assert.equal(typeof rendererModule.groundPresentationOffsetY, 'function');
  assert.equal(typeof rendererModule.applyFixedGroundTransform, 'function');
  const biomes = { currentBlend: { from: 'TAIGA', to: 'TAIGA', t: 1 } };
  const glacier = { enabled: true, captionViewFor: () => ({ glacier: {} }) };
  const ordinary = { enabled: true, captionViewFor: () => ({}) };
  assert.equal(rendererModule.groundPresentationOffsetY(ordinary, biomes, 720, 614), 0);
  const offset = rendererModule.groundPresentationOffsetY(glacier, biomes, 720, 614);
  assert.ok(offset >= 100 && offset <= 115, '550px screen support moves to a narrow bottom ledge');
  const translations = [];
  const ctx = { setTransform() {}, rotate() {}, translate: (x, y) => translations.push([x, y]) };
  rendererModule.applyFixedGroundTransform(ctx, { sx: 1, sy: 1, width: 1280, height: 720,
    camera: { roll: 0, shakeX: 0, shakeY: 0 }, offsetY: offset });
  const delta = translations.reduce((sum, [, y]) => sum + y, 0);
  const support = 614 + delta, castFoot = 614 + delta, pool = 640 + delta;
  assert.ok(support > 650 && support < 670);
  assert.equal(castFoot, support);
  assert.equal(pool - support, 26, 'reflection plane remains registered to support');
  assert.equal(rendererModule.groundPresentationOffsetY(glacier, biomes, 720, 614), offset, 'pause/seek same state');
});
