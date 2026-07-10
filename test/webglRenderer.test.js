// WebGL path factory + resolve mode (MIDI restore + feature).
// No real WebGL in Node — we assert Canvas-safe construction and fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRendererMode, createRenderer, WebGLRenderer } from '../src/render/WebGLRenderer.js';
import { Renderer } from '../src/render/Renderer.js';

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
