// Ridgeview entry point.
import { Engine } from './engine/Engine.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const engine = new Engine(canvas, {
  proxy: params.get('proxy') === '1',
  quality: params.get('quality') || 'high',
  preserve: params.has('test'),
});

const data = await (await fetch('data/viewpoints.json')).json();
const ranges = data.ranges.filter((r) => !r.rejected && r.views.length);
const range = ranges.find((r) => r.id === (params.get('range') || 'tetons')) ?? ranges[0];
const view = structuredClone(range.views[Number(params.get('view') || 0)] ?? range.views[0]);
for (const k of ['heading', 'pitch', 'hfov']) if (params.has(k)) view[k] = Number(params.get(k));
if (params.has('agl')) { view.eye.h += Number(params.get('agl')) - view.eye.agl; view.eye.agl = Number(params.get('agl')); }

engine.rig.fov = 2 * Math.atan(Math.tan((view.hfov * Math.PI) / 360) / (16 / 9)) * 180 / Math.PI;
engine.rig.set(view.eye.lon, view.eye.lat, view.eye.h, view.heading, view.pitch);
engine.looks.setBiome(range.biome);
engine.looks.setContext({ lon: view.eye.lon, lat: view.eye.lat, heading: view.heading, ground: view.eye.h - view.eye.agl, summit: range.summit.elevationM });
if (params.get('light')) engine.looks.setLight(params.get('light'));
if (params.get('weather')) engine.looks.setWeather(params.get('weather'));
if (params.get('style')) engine.looks.setStyle(params.get('style'));
if (params.get('overlay')) engine.looks.setOverlay(params.get('overlay'));
engine.looks.cur = engine.looks._target();
engine.looks.tweens = [];

window.__rv = { engine, range, view };
window.addEventListener('resize', () => engine.resize());
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Keep the eye above the rendered ground (data at the eye can differ from the calculator's).
  const { lon, lat, h } = engine.rig.lonLatH;
  const g = engine.groundAt(lon, lat);
  if (Number.isFinite(g) && h < g + view.eye.agl * 0.98 && !window.__rv.free) {
    engine.rig.set(lon, lat, g + view.eye.agl, view.heading, view.pitch);
  }
  engine.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
