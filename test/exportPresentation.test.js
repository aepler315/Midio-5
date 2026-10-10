// Execute the actual export caller, not a duplicate of its failure policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPresentingRenderer } from '../src/render/PresentingRenderer.js';
import { GraphicsResidency } from '../src/render/GraphicsResidency.js';
import { stepExportClock } from '../src/render/BulkExport.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('function renderExportFrame('), main.indexOf('/** Rebuild the current song at an exact frame size'));
function harness(budgetBytes) {
  const canvas = { width: 800, height: 480, getContext: () => ({}) };
  const residency = new GraphicsResidency({ budgetBytes });
  let draws = 0, disposed = 0;
  const renderer = createPresentingRenderer({ canvas, residency,
    presentation: { pixelated: true, paletteId: 'none', scaling: 'fit' },
    rendererFactory: () => ({ get drawCount() { return draws; }, draw() { draws++; }, dispose() { disposed++; } }) });
  const context = vm.createContext({ bulkExportArmed: true, bulkExportSize: { w: 800, h: 480 }, bulkPresentation: {},
    rangePresentation: { dispose() { disposed++; } }, sim: { step() {} }, renderer, canvas, simTime: 0, STEP_MS: 1000 / 60,
    audioEngine: null, stepExportClock,
    failBulkExport: message => new Error(message),
    abortRecording() {},
    stopTimeline() { renderer.dispose(); context.renderer = null; context.sim = null; },
  });
  vm.runInContext(source, context);
  return { context, renderer, residency, get draws() { return draws; }, get disposed() { return disposed; } };
}
test('export caller rejects denied presentation and aborts the session before returning pixels', () => {
  const h = harness(1);
  assert.throws(() => h.context.renderExportFrame(250), /presentation/i);
  assert.equal(h.context.bulkExportArmed, false);
  assert.equal(h.disposed, 2, 'both presenter and Range session are disposed');
  assert.equal(h.context.bulkExportSize, null);
  assert.equal(h.context.bulkPresentation, null);
  assert.equal(h.draws, 0);
  assert.equal(h.residency.usedBytes, 0);
  assert.equal(h.renderer.getCaptureSource(), null);
  assert.throws(() => h.context.renderExportFrame(500), /not armed/i);
});

test('bulk push rejects an unsuccessful presentation before any canvas read or encoder POST', async () => {
  const bulk = readFileSync(new URL('../tools/bulk-export.mjs', import.meta.url), 'utf8');
  const push = bulk.slice(bulk.indexOf('async function pushExportFrame('), bulk.indexOf('async function chooseWorld('));
  let reads = 0, posts = 0;
  const context = vm.createContext({ performance: { now: () => 0 },
    window: { __SMW: { renderExportFrame: () => ({ width: 800, height: 480, presented: false }) } },
    document: { getElementById() { reads++; throw Error('must not read'); } },
    fetch() { posts++; throw Error('must not encode'); },
  });
  vm.runInContext(push, context);
  await assert.rejects(context.pushExportFrame({ timeMs: 0, width: 800, height: 480 }), /presentation/i);
  assert.equal(reads, 0); assert.equal(posts, 0);
});
