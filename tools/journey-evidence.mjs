// Actual player frames at a declared 30 fps, plus seek/accessibility/context
// checks. The capture wall time is software-WebGL cost, not hardware FPS.
// node tools/journey-evidence.mjs [url] [wav] [output-directory]
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openSong,captureFrame } from './range-scene-smoke.mjs';

const url=process.argv[2]||'http://127.0.0.1:8093';
const wav=path.resolve(process.argv[3]||'.smoke/range-energy/pilot.wav');
const out=path.resolve(process.argv[4]||'.smoke/journey/evidence');
await fs.mkdir(path.join(out,'frames'),{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const report={fps:30,startMs:28000,frames:[],stills:[],checks:{}};
const rounded=value=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='number'?Math.round(item*1e7)/1e7:item));
try{
  const {page,errors}=await openSong(browser,{url,wav,width:960,height:540,params:{rangeRenderer:'v2',seed:'2917029651'}});
  const draw=async(timeMs,file)=>{
    const start=performance.now(),frame=await captureFrame(page,timeMs);
    assert.equal(frame.range.active,true,frame.range.reason);
    assert.equal(frame.range.viewId,'moonlit-journey');
    assert.deepEqual(errors,[]);
    if(file)await fs.writeFile(file,Buffer.from(frame.png,'base64'));
    return {timeMs,wallMs:performance.now()-start,pixels:frame.pixels,scene:frame.range.scene,
      identity:frame.identity,residency:frame.range.residency,png:frame.png};
  };
  for(const time of [250,9000,22000]){
    const sample=await draw(time,path.join(out,`still-${time}.png`));delete sample.png;report.stills.push(sample);
  }
  for(let i=0;i<150;i++){
    const sample=await draw(report.startMs+i*1000/report.fps,path.join(out,'frames',`${String(i).padStart(4,'0')}.png`));
    delete sample.png;report.frames.push(sample);
    if(i%30===0)console.log(`captured ${i+1}/150 frames; ${sample.scene.stats.drawCalls} calls / ${sample.scene.stats.triangles} triangles`);
  }
  for(const time of [48000,58500]){
    const sample=await draw(time,path.join(out,`still-${time}.png`));delete sample.png;report.stills.push(sample);
  }
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await page.evaluate(()=>window.__SMW.seek(9000));
  const seek=await draw(9000,path.join(out,'seek-9000.png'));
  const earlier=report.stills.find(f=>f.timeMs===9000);
  // The fixed-step export clock can arrive within 1e-10 ms of its target;
  // compare far below a visible/world-space unit rather than bit identity.
  assert.deepEqual(rounded(seek.scene.cast),rounded(earlier.scene.cast));
  assert.ok(Math.abs(seek.scene.travelM-earlier.scene.travelM)<1e-7);report.checks.seek=true;
  const held=await draw(9000);assert.equal(held.png,seek.png);report.checks.heldPixels=true;
  await page.evaluate(()=>{window.__SMW.sim.reducedMotion=true;window.__SMW.sim.biomes.reducedMotion=true;});
  const stillA=await draw(12000),stillB=await draw(13000);
  assert.deepEqual(stillA.scene.cast.actors.map(a=>a.positionM),stillB.scene.cast.actors.map(a=>a.positionM));
  assert.equal(stillA.scene.travelM,0);assert.equal(stillB.scene.travelM,0);report.checks.reducedMotion=true;
  await page.evaluate(()=>{window.__SMW.sim.reducedMotion=false;window.__SMW.sim.biomes.reducedMotion=false;
    const r=window.__SMW.sim.biomes.rangePresentation.scene.renderer;
    window.__journeyContext=r.getContext().getExtension('WEBGL_lose_context');window.__journeyContext.loseContext();});
  await page.waitForTimeout(250);
  const lost=await captureFrame(page,14000);assert.equal(lost.range.active,false);
  await page.evaluate(()=>window.__journeyContext.restoreContext());
  await page.waitForTimeout(300);
  await page.evaluate(()=>window.__SMW.rangeReady({timeoutMs:10000}));
  await draw(14500);report.checks.contextRecovery=true;
  report.errors=errors;
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks,stats:report.frames[0].scene.stats,errors}));
}finally{await browser.close();}
