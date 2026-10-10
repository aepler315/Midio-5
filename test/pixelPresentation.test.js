import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPixelRect, PixelPresentation } from '../src/render/PixelPresentation.js';
import { createPresentingRenderer } from '../src/render/PresentingRenderer.js';
import { GraphicsResidency } from '../src/render/GraphicsResidency.js';

const pixel = { pixelated: true, grid: { width: 320, height: 180 }, paletteId: 'none', dither: 1, quality: 'auto', scaling: 'fit' };
function surface(width = 800, height = 480) {
  const canvas = { width, height, reads: 0, writes: 0, draws: [], fills: [] };
  const ctx = { canvas, setTransform() {}, imageSmoothingEnabled: true, fillRect(...a) { canvas.fills.push(a); },
    drawImage(...a) { canvas.draws.push({ args: a, smooth: this.imageSmoothingEnabled }); },
    getImageData() { canvas.reads++; return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
    putImageData() { canvas.writes++; } };
  canvas.getContext = () => ctx;
  canvas.ownerDocument = { createElement: () => surface(0, 0) };
  return canvas;
}
test('pixel fitting preserves aspect, integer scale and sub-grid targets', () => {
  assert.deepEqual(fitPixelRect(320, 180, 800, 480, 'integer'), { x: 80, y: 60, width: 640, height: 360, scale: 2 });
  assert.deepEqual(fitPixelRect(320, 180, 800, 480, 'fit'), { x: 0, y: 15, width: 800, height: 450, scale: 2.5 });
  assert.deepEqual(fitPixelRect(320, 180, 720, 720, 'fit'), { x: 0, y: 157.5, width: 720, height: 405, scale: 2.25 });
  assert.equal(fitPixelRect(320, 180, 160, 90, 'integer').scale, .5);
  assert.equal(fitPixelRect(320, 180, 1920, 1080, 'integer').scale, 6);
  assert.equal(fitPixelRect(320, 180, 540, 960, 'fit').height, 303.75);
});
test('one bounded palette pass precedes the nearest-neighbor output composite', () => {
  const output = surface();
  const owner = new PixelPresentation({ canvas: output, presentation: { ...pixel, paletteId: 'rgb332' } });
  const working = owner.beginFrame();
  assert.equal(working.width * working.height, 57600);
  owner.finishFrame();
  assert.equal(working.reads, 1);
  assert.equal(working.writes, 1);
  assert.equal(output.reads, 0);
  assert.equal(output.draws.at(-1).smooth, false);
  assert.deepEqual(output.draws.at(-1).args.slice(1), [0, 15, 800, 450]);
  assert.deepEqual(output.fills.at(-1), [0, 0, 800, 480]);
  assert.equal(owner.getCaptureSource().canvas, working);
  owner.dispose(); owner.dispose();
});
test('adapter forwards compositor state and draws at the working resolution', () => {
  let drawn;
  const inner = { backend: 'canvas', drawCount: 0, draw() { this.drawCount++; drawn = [this.canvas.width, this.canvas.height]; }, dispose() {} };
  const adapter = createPresentingRenderer({ canvas: surface(), presentation: pixel, rendererFactory: canvas => { inner.canvas = canvas; return inner; } });
  const range = {}, composer = {};
  adapter.rangePresentation = range; adapter.hudInFrame = true; adapter.composer = composer;
  adapter.draw({}, 0);
  assert.deepEqual(drawn, [320, 180]);
  assert.equal(inner.rangePresentation, range); assert.equal(inner.composer, composer); assert.equal(inner.hudInFrame, true);
  assert.equal(adapter.drawCount, 1); assert.equal(adapter.getCaptureSource().pixelated, true);
  adapter.dispose();
});
test('profile and song changes release bounded working resources', () => {
  const residency = new GraphicsResidency({ budgetBytes: 1000000 });
  const baseline = residency.entries.size;
  for (let song = 0; song < 20; song++) {
    const owner = new PixelPresentation({ canvas: surface(), presentation: pixel, residency });
    for (let i = 0; i < 100; i++) { owner.setPresentation({ ...pixel, paletteId: i % 2 ? 'rgb332' : 'none' }); owner.beginFrame(); owner.finishFrame(); }
    assert.equal(residency.entries.size, baseline + 1);
    owner.dispose(); owner.dispose();
    assert.equal(residency.entries.size, baseline);
  }
});
test('allocation refusal never bypasses the residency budget', () => {
  const residency = new GraphicsResidency({ budgetBytes: 1 });
  const owner = new PixelPresentation({ canvas: surface(), presentation: pixel, residency });
  assert.equal(owner.beginFrame(), null);
  assert.equal(owner.diagnostics.paletteStatus.reason, 'unavailable');
  assert.equal(residency.entries.size, 0);
  owner.dispose();
});
test('persistent readback failures retry only after a presentation generation changes', () => {
  const canvas = surface(320, 180);
  let attempts = 0;
  canvas.getContext().getImageData = () => { attempts++; throw Object.assign(Error('tainted'), { name: 'SecurityError' }); };
  const owner = new PixelPresentation({ canvas, presentation: { ...pixel, paletteId: 'rgb332' } });
  for (let i = 0; i < 4; i++) { owner.beginFrame(); owner.finishFrame(); }
  assert.equal(attempts, 1);
  assert.equal(owner.diagnostics.effectiveLook, 'pixel');
  owner.setPresentation({ ...pixel, paletteId: 'rgb332', dither: .35 });
  owner.beginFrame(); owner.finishFrame();
  assert.equal(attempts, 2);
  owner.dispose();
});

for (const failure of ['denied', 'output-context', 'working-context', 'creation', 'commit']) {
  test(`failed ${failure} presentation publishes no first or stale capture and cleans up`, () => {
    const canvas = surface();
    const residency = new GraphicsResidency({ budgetBytes: 1000000 });
    const owner = new PixelPresentation({ canvas, presentation: pixel, residency });
    assert.equal(owner.getCaptureSource(), null, 'a canvas reference is not a frame');
    const source = owner.beginFrame();
    assert.ok(source);
    const good = owner.finishFrame();
    assert.equal(good.presented, true);
    assert.equal(owner.getCaptureSource().generation, good.generation);
    owner.setPresentation({ ...pixel, pixelated: false }); // releases the working surface
    assert.equal(owner.getCaptureSource(), null);
    owner.setPresentation({ ...pixel, paletteId: 'range32' });
    if (failure === 'denied') residency.budgetBytes = 1;
    if (failure === 'output-context') canvas.getContext = () => null;
    if (failure === 'working-context') canvas.ownerDocument.createElement = () => ({ width: 0, height: 0, getContext: () => null });
    if (failure === 'creation') canvas.ownerDocument.createElement = () => { throw Error('creation failed'); };
    if (failure === 'commit') {
      const commit = residency.commit.bind(residency);
      residency.commit = (reservation, resource, dispose) => { residency.release(reservation.key); return commit(reservation, resource, dispose); };
    }
    assert.equal(owner.beginFrame(), null);
    assert.equal(owner.finishFrame().presented, false);
    assert.equal(owner.getCaptureSource(), null, 'failed new profile must not advertise the previous frame');
    assert.equal(residency.usedBytes, 0);
    owner.dispose();
    assert.equal(owner.getCaptureSource(), null);
    const first = new PixelPresentation({ canvas, presentation: pixel, residency });
    assert.equal(first.beginFrame(), null);
    assert.equal(first.finishFrame().presented, false);
    assert.equal(first.getCaptureSource(), null);
    assert.equal(residency.usedBytes, 0);
    first.dispose();
  });
}
test('capture is invalid during a draw, after resize, external release and disposal', () => {
  const canvas = surface(), residency = new GraphicsResidency();
  const owner = new PixelPresentation({ canvas, presentation: pixel, residency });
  owner.beginFrame(); owner.finishFrame();
  const first = owner.getCaptureSource();
  owner.beginFrame();
  assert.equal(owner.getCaptureSource(), null);
  owner.finishFrame();
  assert.ok(owner.getCaptureSource().frameId > first.frameId);
  canvas.width = 1920;
  assert.equal(owner.getCaptureSource(), null);
  owner.beginFrame(); owner.finishFrame();
  residency.release(owner.key);
  assert.equal(owner.getCaptureSource(), null);
  assert.equal(owner.beginFrame().width, 320, 'released buffers are recreated with a reservation');
  owner.finishFrame(); owner.dispose();
  assert.equal(owner.getCaptureSource(), null);
});
test('failed output composite invalidates capture while a completed SecurityError Pixel fallback is valid', () => {
  const canvas = surface(), owner = new PixelPresentation({ canvas, presentation: { ...pixel, paletteId: 'range32' } });
  const source = owner.beginFrame();
  source.getContext('2d').getImageData = () => { throw Object.assign(Error('tainted'), { name: 'SecurityError' }); };
  assert.equal(owner.finishFrame().presented, true);
  assert.ok(owner.getCaptureSource());
  owner.beginFrame();
  canvas.getContext('2d').drawImage = () => { throw Error('composite failed'); };
  assert.equal(owner.finishFrame().presented, false);
  assert.equal(owner.getCaptureSource(), null);
  owner.dispose();
});
test('adapter explicitly reports an unsuccessful allocation without drawing', () => {
  let draws = 0;
  const adapter = createPresentingRenderer({ canvas: surface(), presentation: pixel, residency: new GraphicsResidency({ budgetBytes: 1 }),
    rendererFactory: () => ({ draw() { draws++; }, dispose() {} }) });
  assert.equal(adapter.draw({}, 0).presented, false);
  assert.equal(draws, 0);
  assert.equal(adapter.getCaptureSource(), null);
  adapter.dispose();
});
