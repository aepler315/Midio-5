import assert from 'node:assert/strict';

// These checks establish content/geometry, not an artistic quality verdict.
export function assertMeaningfulFrame(frame) {
  assert.ok(frame.opaque && frame.colors >= 8 && frame.litFraction > .12 && frame.mean > 8,
    `blank or insufficient scene content: ${JSON.stringify(frame)}`);
}
export function assertTemporalChange(thumbnails) {
  assert.ok(thumbnails.length >= 2, 'need a controlled temporal sequence');
  const first = thumbnails[0];
  assert.ok(thumbnails.slice(1).some(next => next.length === first.length && next.some((v,i) => Math.abs(v-first[i]) > 8)),
    'frozen controlled temporal sequence');
}

// Self-contained for page.evaluate. Exact palette membership is tested only
// on opaque pre-encode buffers, never on lossy decoded RGB.
export async function inspectPixelFrame({ paletteId = 'none' } = {}) {
  const smw = window.__SMW, canvas = document.querySelector('#stage');
  const capture = smw.renderer?.getCaptureSource();
  const px = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const colors = new Set(); let lit = 0, sum = 0, opaque = true;
  for (let i=0;i<px.length;i+=4) {
    colors.add(`${px[i]},${px[i+1]},${px[i+2]}`);
    const brightness = px[i]+px[i+1]+px[i+2]; sum += brightness;
    if (brightness > 24) lit++; if (px[i+3] !== 255) opaque = false;
  }
  const thumb = document.createElement('canvas'); thumb.width=64;thumb.height=36;
  const ctx=thumb.getContext('2d');ctx.drawImage(canvas,0,0,64,36);
  let paletteErrors=0;
  if (paletteId !== 'none' && capture) {
    const { RANGE32_COLORS } = await import('/src/render/PaletteCatalog.js');
    const allowed = new Set(RANGE32_COLORS.map(hex=>[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16)).join(',')));
    const source = capture.canvas, raw=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    for(let i=0;i<raw.length;i+=4) {
      if (raw[i+3] !== 255) { paletteErrors++; continue; }
      if (paletteId === 'range32') { if(!allowed.has(`${raw[i]},${raw[i+1]},${raw[i+2]}`))paletteErrors++; }
      else if (![0,36,73,109,146,182,219,255].includes(raw[i]) || ![0,36,73,109,146,182,219,255].includes(raw[i+1]) || ![0,85,170,255].includes(raw[i+2])) paletteErrors++;
    }
  }
  return { width:canvas.width,height:canvas.height,colors:colors.size,litFraction:lit/(px.length/4),mean:sum/(px.length/4*3),opaque,
    paletteErrors,thumbnail:[...ctx.getImageData(0,0,64,36).data],presentation:smw.presentationDiagnostics,backend:smw.rangeState,
    timeMs:smw.sim.timeMs,seed:smw.songSeed,dpr:devicePixelRatio,png:canvas.toDataURL('image/png').split(',')[1] };
}
