import test from 'node:test';
import assert from 'node:assert/strict';
import { createVersionHandoffStore } from '../src/ui/VersionHandoff.js';

// A DOM boundary only; all switch/restore logic is the production navigator.
class Element extends EventTarget {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map();
    this.hidden = false; this.disabled = false; this.tabIndex = 0; this.textContent = '';
    const classes = new Set();
    this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, value) => value ? classes.add(x) : classes.delete(x) };
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  remove() { this.parentElement.children = this.parentElement.children.filter(n => n !== this); }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(c => [(selector === 'button' && c.tagName === 'BUTTON') || (selector.startsWith('#') && c.id === selector.slice(1)) ? c : null, ...c.querySelectorAll(selector)]).filter(Boolean); }
}
function fixture(overrides = {}) {
  const app = new Element(), hud = new Element(), right = new Element();
  const document = { createElement: tag => new Element(tag), getElementById: id => ({ app, hud, hudRight: right })[id], body: app, defaultView: new EventTarget(), baseURI: 'https://example.test/Midio-5/' };
  document.defaultView.location = { href: document.baseURI };
  const manifest = { schema: 1, buildSha: 'a'.repeat(40), liveId: 'live', entries: ['old', 'live', 'new'].map((id, i) => ({ id, label: `Version ${id}`, sourceSha: String(i + 1).repeat(40), sourcePr: i + 1, entryPath: id === 'live' ? './' : `versions/${id}/`, live: id === 'live' })) };
  let state = { phase: 'ready', generation: 1, sourceId: 'source-1', source: { kind: 'audio-files', files: [{}] }, positionMs: 1200, durationMs: 5000, seed: 42, paused: false, settings: { reducedFlash: true, export: true } };
  const calls = [], listeners = new Set(), navigated = [];
  const adapter = { getState: () => ({ ...state }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, pause: async () => { calls.push('pause'); state.paused = true; }, setPaused: async p => { calls.push(['paused', p]); state.paused = p; }, loadSource: async (source, intent) => { calls.push(['load', source, intent]); state = { ...state, phase: 'ready', sourceId: intent.sourceId, positionMs: intent.positionMs, paused: true }; }, seek: async ms => { calls.push(['seek', ms]); state.positionMs = ms; }, wakeHud: () => calls.push('wake') };
  const store = { saveSource: async () => { calls.push('save'); return 'source-1'; }, prepareSwitch: async value => { calls.push(['handoff', value]); return { schema: 1, ...value, switchId: 'switch-1' }; }, readPending: async () => null, readLatest: async () => null, readSource: async () => ({ kind: 'audio-files', files: [{}] }), completeSwitch: async handoff => { calls.push(['complete', handoff]); }, release: async () => { calls.push('release'); }, discardSource: async () => { calls.push('discard'); }, dispose: async () => {} };
  const preflight = async url => { calls.push(['preflight', url.href]); };
  const options = { document, manifest, currentId: 'live', siteRoot: new URL(document.baseURI), adapter, handoffStore: store, preflight, navigate: url => navigated.push(url.href), ...overrides };
  return { options, app, right, calls, store, adapter, navigated, setState: values => { state = { ...state, ...values }; listeners.forEach(fn => fn(state)); }, button: id => app.querySelector(`#${id}`) };
}
async function mount(f) {
  const module = await import('../src/ui/VersionNavigation.js').catch(() => null);
  assert.ok(module?.mountVersionNavigation, 'version navigator implementation exists');
  const nav = module.mountVersionNavigation(f.options); await nav.ready; return nav;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const click = button => button.dispatchEvent(new Event('click', { cancelable: true }));

test('switch preflights before source persistence and navigates only after completed handoff', async () => {
  const f = fixture(); let finish;
  f.store.prepareSwitch = value => new Promise(resolve => { f.calls.push(['handoff', value]); finish = () => resolve({ ...value, switchId: 'switch-1' }); });
  const nav = await mount(f); click(f.button('versionPrevious')); click(f.button('versionPrevious')); await flush();
  assert.equal(f.navigated.length, 0); assert.equal(f.calls.filter(c => c === 'save').length, 1);
  assert.equal(f.calls[0][0], 'preflight'); assert.equal(f.button('versionNext').disabled, true);
  finish(); await flush();
  assert.equal(f.navigated[0], 'https://example.test/Midio-5/versions/old/?versionSwitch=switch-1');
  const handoff = f.calls.find(c => c[0] === 'handoff')[1];
  assert.equal(handoff.paused, false); assert.deepEqual(handoff.settings, { reducedFlash: true }); assert.equal(f.calls.at(-1), 'release'); nav.dispose();
});
test('endpoint is visible and disabled with accurate target names', async () => {
  const f = fixture({ currentId: 'old' }); const nav = await mount(f);
  assert.equal(f.button('versionPrevious').disabled, true); assert.equal(f.button('versionPrevious').hidden, false);
  assert.match(f.button('versionNext').getAttribute('aria-label'), /Version live/);
  assert.equal(f.button('versionReturnLive').hidden, false); nav.dispose();
});
test('title navigation needs no source transaction and strips diagnostic query flags', async () => {
  const f = fixture(); f.options.document.defaultView.location.href += '?export=1&fps=1'; f.setState({ phase: 'title', source: null, sourceId: null });
  const nav = await mount(f); click(f.button('versionNext')); await flush();
  assert.equal(f.navigated[0], 'https://example.test/Midio-5/versions/new/'); assert.equal(f.calls.includes('save'), false); nav.dispose();
});
test('recording and replacement loading cannot navigate or reuse an old source', async () => {
  const f = fixture(); const nav = await mount(f);
  for (const blocked of [{ blockedReason: 'Finish recording first.' }, { phase: 'loading', blockedReason: null }]) {
    f.setState(blocked); click(f.button('versionNext')); await flush(); assert.equal(f.navigated.length, 0); assert.equal(f.button('versionNext').disabled, true);
  } nav.dispose();
});
test('failed preflight retains playback and offers live Retry and Return controls', async () => {
  let fail = true; const f = fixture({ preflight: async () => { if (fail) throw new Error('Missing destination'); } }); const nav = await mount(f);
  click(f.button('versionPrevious')); await flush(); assert.equal(f.calls.includes('save'), false);
  assert.equal(f.button('versionRetry').hidden, false); assert.equal(f.button('versionReturnLive').hidden, false);
  assert.equal(f.button('versionRetry').disabled, false); assert.equal(f.navigated.length, 0);
  fail = false; click(f.button('versionRetry')); await flush(); assert.equal(f.navigated.length, 1); nav.dispose();
});
test('storage failure after pause recovers prior running state without leaving', async () => {
  const f = fixture(); f.store.prepareSwitch = async () => { throw new Error('Quota exceeded'); }; const nav = await mount(f);
  click(f.button('versionNext')); await flush(); assert.equal(f.navigated.length, 0); assert.ok(f.calls.some(c => Array.isArray(c) && c[0] === 'paused' && c[1] === false)); nav.dispose();
});
test('replacement during persistence blocks departure and does not pause replacement', async () => {
  const f = fixture(); let finish; f.store.saveSource = () => new Promise(resolve => { finish = resolve; }); const nav = await mount(f);
  click(f.button('versionNext')); await flush(); f.setState({ phase: 'loading', sourceId: 'replacement' }); finish('source-1'); await flush();
  assert.equal(f.navigated.length, 0); assert.equal(f.calls.includes('pause'), false); nav.dispose();
});
test('hidden navigation is inert, unfocusable and its first attempted activation only wakes HUD', async () => {
  const f = fixture(); const nav = await mount(f); f.right.classList.add('hud-faded'); f.setState({});
  const root = f.button('versionPrevious').parentElement;
  assert.equal(root.inert, true); assert.equal(f.button('versionPrevious').tabIndex, -1);
  click(f.button('versionPrevious')); await flush(); assert.deepEqual(f.calls, ['wake']); assert.equal(f.navigated.length, 0); nav.dispose();
});
test('boot restore is held paused, validated, resumed then committed once across pageshow', async () => {
  const f = fixture(); const handoff = { sourceId: 'source-2', fromId: 'old', toId: 'live', switchId: 's', positionMs: 2400, durationMs: 5000, paused: false, seed: 4 };
  f.store.readPending = async () => handoff; const nav = await mount(f);
  assert.equal(f.calls.filter(c => c[0] === 'load').length, 1); assert.deepEqual(f.calls.find(c => c[0] === 'paused'), ['paused', false]);
  assert.equal(f.calls.filter(c => c[0] === 'complete').length, 1); f.options.document.defaultView.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(f.calls.filter(c => c[0] === 'load').length, 1); nav.dispose();
});
test('audio gesture denial keeps intent and exposes one Resume action', async () => {
  const f = fixture(); let denied = true; const original = f.adapter.loadSource;
  f.adapter.loadSource = async (...args) => { if (denied) throw Object.assign(new Error('Audio blocked'), { code: 'AUDIO_GESTURE_REQUIRED' }); return original(...args); };
  f.store.readPending = async () => ({ sourceId: 'source-1', toId: 'live', positionMs: 1700, paused: true, switchId: 's' });
  const nav = await mount(f); assert.equal(f.button('versionRetry').textContent, 'Resume'); assert.equal(f.calls.some(c => c[0] === 'complete'), false);
  denied = false; click(f.button('versionRetry')); await flush(); assert.equal(f.calls.filter(c => c[0] === 'load').length, 1); assert.equal(f.calls.filter(c => c[0] === 'complete').length, 1); nav.dispose();
});
test('a saved source that has been replaced is not resurrected on pageshow', async () => {
  const f = fixture(); let latest = null; f.store.readLatest = async () => latest; const nav = await mount(f);
  latest = { sourceId: 'old-source', toId: 'live', positionMs: 1700, paused: true }; f.setState({ sourceId: 'new-source' });
  f.options.document.defaultView.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(f.calls.some(c => c[0] === 'load'), false); nav.dispose();
});
test('new load and Stop invalidate persisted sessions but restoring does not', async () => {
  const f = fixture(); const nav = await mount(f);
  f.setState({ phase: 'loading', sourceId: null, source: null }); await flush(); assert.equal(f.calls.filter(c => c === 'discard').length, 1);
  f.setState({ phase: 'ready', sourceId: 'new', source: { kind: 'demo' } }); f.setState({ phase: 'title', sourceId: null, source: null }); await flush();
  assert.equal(f.calls.filter(c => c === 'discard').length, 2); nav.dispose();
});
test('Return after failed restore retargets its exact pending token and retains transport intent', async () => {
  const f = fixture({ currentId: 'old' }); f.adapter.loadSource = async () => { f.setState({ phase: 'error', sourceId: null, source: null }); throw new Error('Cannot decode'); };
  f.store.readPending = async () => ({ sourceId: 'source-1', toId: 'old', positionMs: 1700, paused: false, switchId: 'failed-s' });
  const nav = await mount(f); click(f.button('versionReturnLive')); await flush();
  assert.equal(f.navigated[0], 'https://example.test/Midio-5/?versionSwitch=switch-1');
  const sent = f.calls.find(c => c[0] === 'handoff')[1]; assert.equal(sent.replaceSwitchId, 'failed-s'); assert.equal(sent.positionMs, 1700); assert.equal(sent.paused, false); nav.dispose();
});
test('latest restore after Back uses the real store without consuming a nonexistent pending transaction', async () => {
  const rows = new Map(), session = new Map();
  const store = createVersionHandoffStore({ storage: { atomic: fn => fn({ get: async k => rows.get(k), put: async (k,v) => rows.set(k,v), delete: async k => rows.delete(k), entries: async () => [...rows] }) }, sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k,v) => session.set(k,v) }, locks: null, lifecycle: null, heartbeat: false });
  const source = { kind: 'demo' }; const state = { phase: 'ready', sourceId: 'demo-1', source, positionMs: 1300, seed: 7, paused: true };
  await store.saveSource(state); const pending = await store.prepareSwitch({ ...state, fromId: 'old', toId: 'live' }); await store.completeSwitch(pending);
  const f = fixture({ currentId: 'old', handoffStore: store }); f.setState({ phase: 'title', sourceId: null, source: null });
  const nav = await mount(f); assert.equal(f.button('versionRetry').hidden, true); assert.equal(f.calls.filter(c => c[0] === 'load').length, 1);
  assert.equal(f.calls.find(c => c[0] === 'load')[2].positionMs, 1300); nav.dispose(); await store.dispose();
});
test('missing manifest presents usable Retry and Return while leaving playback alone', async () => {
  const f = fixture(); const view = f.options.document.defaultView; view.__MIDIO_VERSION_ADAPTER = f.adapter;
  view.location.assign = url => f.navigated.push(url);
  const metadata = new Element('script'); metadata.textContent = JSON.stringify({ currentId: 'old', liveId: 'live', siteRootRelative: './' });
  const get = f.options.document.getElementById; f.options.document.getElementById = id => id === 'midio-version-metadata' ? metadata : get(id);
  const module = await import('../src/ui/VersionBootstrap.js').catch(() => null); assert.ok(module?.bootstrapVersionNavigation, 'shared bootstrap exists');
  let missing = true;
  const boot = module.bootstrapVersionNavigation({ document: f.options.document, fetch: async url => ({ ok: !missing || !url.includes('manifest'), url, headers: { get: () => 'text/html' }, json: async () => f.options.manifest }), createStore: () => f.store });
  await boot.ready; assert.equal(f.button('versionRetry').disabled, false); assert.equal(f.button('versionReturnLive').disabled, false); assert.equal(f.calls.includes('pause'), false);
  missing = false; click(f.button('versionRetry')); await flush(); assert.match(f.button('versionNext').getAttribute('aria-label'), /Version live/); boot.dispose();
});
test('Resume after playback denial uses the already validated paused generation', async () => {
  const f = fixture(); const original = f.adapter.setPaused; let denied = true;
  f.adapter.setPaused = async paused => { if (denied && !paused) throw Object.assign(new Error('Tap to resume'), { code: 'AUDIO_GESTURE_REQUIRED' }); return original(paused); };
  f.store.readPending = async () => ({ sourceId: 'source-1', toId: 'live', positionMs: 1700, paused: false, switchId: 's' });
  const nav = await mount(f); assert.equal(f.calls.filter(c => c[0] === 'load').length, 1);
  denied = false; click(f.button('versionRetry')); await flush(); assert.equal(f.calls.filter(c => c[0] === 'load').length, 1); assert.equal(f.calls.filter(c => c[0] === 'complete').length, 1); nav.dispose();
});
test('Back from a cached departing document applies latest transport to the same source without reloading', async () => {
  const f = fixture(); let latest = null; f.store.readLatest = async () => latest;
  const nav = await mount(f); click(f.button('versionNext')); await flush();
  latest = { sourceId: 'source-1', toId: 'live', positionMs: 3500, paused: false, switchId: 'next-switch' };
  f.options.document.defaultView.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(f.calls.some(c => c[0] === 'load'), false); assert.ok(f.calls.some(c => c[0] === 'seek' && c[1] === 3500)); assert.equal(f.adapter.getState().paused, false); nav.dispose();
});
test('a deliberate replacement after restore failure removes the old retry intent', async () => {
  const f = fixture(); f.adapter.loadSource = async () => { throw new Error('Decode failed'); };
  f.store.readPending = async () => ({ sourceId: 'old-source', toId: 'live', positionMs: 1700, paused: true, switchId: 's' });
  const nav = await mount(f); assert.equal(f.button('versionRetry').hidden, false);
  f.setState({ phase: 'loading', sourceId: null, source: null }); await flush(); assert.equal(f.button('versionRetry').hidden, true); assert.equal(f.calls.filter(c => c === 'discard').length, 1); nav.dispose();
});
test('a synchronous adapter initialization failure leaves no partially mounted navigator', async () => {
  const f = fixture(); let reads = 0; const original = f.adapter.getState;
  f.adapter.getState = () => { if (++reads > 1) throw new Error('Adapter unavailable'); return original(); };
  await assert.rejects(mount(f), /Adapter unavailable/); assert.equal(f.app.querySelectorAll('#versionPrevious').length, 0);
});
test('user replacement during an owned restore cancels its old intent even for loading-to-loading changes', async () => {
  const f = fixture(); let rejectOld, loads = 0;
  f.store.readPending = async () => ({ sourceId: 'old-source', toId: 'live', positionMs: 1700, paused: true, switchId: 's' });
  f.adapter.loadSource = () => { loads++; f.setState({ phase: 'loading', sourceId: null, source: null, generation: 2 }); return new Promise((resolve, reject) => { rejectOld = reject; }); };
  const { mountVersionNavigation } = await import('../src/ui/VersionNavigation.js'); const nav = mountVersionNavigation(f.options); await flush();
  f.setState({ phase: 'loading', sourceId: null, source: null, generation: 3 }); rejectOld(new Error('Old generation cancelled')); await nav.ready;
  f.setState({ phase: 'ready', sourceId: 'new-source', source: { kind: 'demo' }, generation: 3 }); click(f.button('versionRetry')); await flush();
  assert.equal(f.button('versionRetry').hidden, true); assert.equal(loads, 1); assert.equal(f.calls.filter(c => c === 'discard').length, 1); assert.equal(f.calls.some(c => c[0] === 'complete'), false); nav.dispose();
});
test('title preflight cannot navigate away from a newly selected song without carrying it', async () => {
  let finish; const f = fixture({ preflight: () => new Promise(resolve => { finish = resolve; }) }); f.setState({ phase: 'title', sourceId: null, source: null });
  const nav = await mount(f); click(f.button('versionNext')); await flush(); f.setState({ phase: 'loading', generation: 2 }); finish(); await flush();
  assert.equal(f.navigated.length, 0); assert.equal(f.calls.includes('save'), false); nav.dispose();
});
test('recording after a completion failure still blocks Return to live', async () => {
  const f = fixture(); f.store.readPending = async () => ({ sourceId: 'source-1', toId: 'live', positionMs: 1700, paused: false, switchId: 's' }); f.store.completeSwitch = async () => { throw new Error('Storage denied'); };
  const nav = await mount(f); f.setState({ blockedReason: 'Finish recording before changing versions.' }); click(f.button('versionReturnLive')); await flush();
  assert.equal(f.navigated.length, 0); assert.equal(f.button('versionReturnLive').disabled, true); nav.dispose();
});
test('Return after completion failure pauses and carries the current heard position', async () => {
  const f = fixture({ currentId: 'old' }); f.store.readPending = async () => ({ sourceId: 'source-1', toId: 'old', positionMs: 1700, paused: false, switchId: 's' }); f.store.completeSwitch = async () => { throw new Error('Storage denied'); };
  const nav = await mount(f); f.setState({ positionMs: 3600 }); click(f.button('versionReturnLive')); await flush();
  const sent = f.calls.find(c => c[0] === 'handoff')[1]; assert.equal(sent.positionMs, 3600); assert.equal(sent.paused, false); assert.equal(f.calls.includes('pause'), true); nav.dispose();
});
test('built-in demo surfing explains that each version uses its own demo', async () => {
  const f = fixture(); f.setState({ source: { kind: 'demo' } }); const nav = await mount(f); assert.match(f.button('versionStatus').textContent, /own built-in demo/); nav.dispose();
});
