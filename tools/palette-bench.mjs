// Arithmetic only. Real Canvas readback timings are in pixel-manifest.json.
import { performance } from 'node:perf_hooks';
import { compilePalette, quantizePalette, quantizeImageData } from '../src/render/PaletteQuantize.js';
import { RANGE32_COLORS } from '../src/render/PaletteCatalog.js';
const width=320,height=180,count=120;
const input=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:(Math.imul(i,1664525)>>>16)&255);
const palette=compilePalette(RANGE32_COLORS);
const results=[];
for (const name of ['range32','rgb332']) {
  const frame={width,height,data:new Uint8ClampedArray(input)};
  const transform=()=>name==='range32'?quantizePalette(frame,palette,{dither:.35}):quantizeImageData(frame);
  for(let i=0;i<10;i++){frame.data.set(input);transform();}
  let elapsed=0;
  for(let i=0;i<count;i++){frame.data.set(input);const t=performance.now();transform();elapsed+=performance.now()-t;}
  results.push({palette:name,frames:count,pixelsPerFrame:width*height,meanTransformMs:elapsed/count,microsecondsPerPixel:elapsed*1000/(count*width*height)});
}
console.log(JSON.stringify({runtime:process.version,scope:'transform only, warm lookup; excludes Canvas readback/upload',results},null,2));
