// Real WAV analysis, actual cove renderer, fixed-camera spatial differences,
// and a 12 fps preview with synchronized sound. Software WebGL, not an FPS test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openSong, captureFrame } from './range-scene-smoke.mjs';
import { seedBrowserConstruction } from './lib/landscape-browser.mjs';

const url=process.argv[2]||'http://127.0.0.1:8093';
const out=path.resolve(process.argv[3]||'.smoke/range-energy');
const frameCount=Number(process.argv[4])||48, fps=12, startMs=30000;
await fs.mkdir(path.join(out,'frames'),{recursive:true});
const wav=path.join(out,'pilot.wav');
execFileSync(process.execPath,['tools/gen-pilot-wav.mjs',wav,'60']);
const files=['RangeEnergy.js','RangePerformance.js','RangeFrame.js','RangeScene.js','RangeFirmament.js','FirmamentGL.js','TerrainMaterial.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function identity(){
  const result={};
  for(const name of files){
    const file=`src/world/alpine/${name}`,local=await fs.readFile(file);
    const response=await fetch(new URL(file,url));
    assert.ok(response.ok);
    result[file]=hash(local);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())),result[file],`served ${file}`);
  }
  return result;
}
const report={limitation:'Deterministic synthetic WAV and software WebGL; hardware frame rate is unmeasured.',fps,frames:[]};
const baseline=execFileSync('git',['show','7f06c28:src/world/alpine/RangePerformance.js'],{encoding:'utf8'});
report.baseline='7f06c28';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const seeded={async newContext(options){
  const context=await browser.newContext(options);
  await context.addInitScript(seedBrowserConstruction,315);
  await context.route('**/RangePerformance.js?baseline',route=>route.fulfill({contentType:'text/javascript',body:baseline}));
  return context;
}};

async function read(page){
  return page.evaluate(()=>{
    const app=window.__SMW,pres=app.sim.biomes.rangePresentation;
    const p=pres.scene.prepared.get(app.rangeState.viewId);
    return {timeMs:app.sim.timeMs,pose:p.habitat.snapshot,sky:pres.frame.skyMusic,
      curtain:p.uniforms.uFirmamentMotion.value.toArray(),camera:pres.scene.camera.position.toArray(),
      activity:pres.frame.habitatMusic?.activity01,kick:pres.frame.habitatMusic?.kick01,
      fullSky:p.uniforms.uFullSky.value,mirror:p.uniforms.uMirrorAmount.value};
  });
}
const spatial=state=>state.pose.actors.map(({positionM,heightM,leanRad,turnRad,headAngle,tailAngle,jawOpen,babies})=>
  ({positionM,heightM,leanRad,turnRad,headAngle,tailAngle,jawOpen,babies}));
function near(a,b){
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<1e-6,`${a} vs ${b}`);return;}
  if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a),Object.keys(b));for(const key of Object.keys(a))near(a[key],b[key]);return;}
  assert.equal(a,b);
}
try{
  report.sourceHashes=await identity();
  const opened=await openSong(seeded,{url,wav,width:640,height:360,params:{rangeRenderer:'v2',seed:'2917029651'}});
  const {page}=opened;
  await captureFrame(page,250);
  const first=await captureFrame(page,startMs);
  assert.equal(first.range.mode,'v2');
  assert.equal(first.range.viewId,'muncho-lake-south');
  await fs.writeFile(path.join(out,'moonlight.png'),Buffer.from(first.png,'base64'));
  const original=await read(page);
  // Fixed camera projection makes pose travel independent of the rail.
  // Compare old and new samplers on the exact same real analyzed music.
  report.travel=await page.evaluate(async()=>{
    const app=window.__SMW,pres=app.sim.biomes.rangePresentation,scene=pres.scene;
    const layout=scene.prepared.get(app.rangeState.viewId).habitatLayout;
    const current=await import('/src/world/alpine/RangePerformance.js');
    const prior=await import('/src/world/alpine/RangePerformance.js?baseline');
    const project=p=>new scene.THREE.Vector3(...p).project(scene.camera).toArray().slice(0,2).map((v,i)=>v*(i?180:320));
    const result={};
    for(const [name,sampler] of [['before',prior],['after',current]]){
      result[name]={};
      for(const [section,start] of [['quiet',10000],['energetic',30000]]){
        const travel={midio:0,broshi:0,midasus:0};let last;
        for(let i=0;i<=48;i++){
          const timeMs=start+i*1000/12;
          const pose=sampler.sampleRangePerformance({layout,timeMs,music:app.sim.biomes.ridgeMusicSession.sample(timeMs)});
          const points=pose.actors.map(a=>{
            // An articulated point one body height from the root. This is
            // a pose-space diagnostic; pixel isolation below proves rendering.
            const angle=a.leanRad+(a.id==='broshi'?a.headAngle:0);
            return project(a.positionM.map((v,j)=>v+layout.right[j]*Math.sin(angle)*a.heightM+(j===1?Math.cos(angle)*a.heightM:0)));
          });
          if(last)points.forEach((p,j)=>{travel[pose.actors[j].id]+=Math.hypot(...p.map((v,k)=>v-last[j][k]));});
          last=points;
        }
        result[name][section]=travel;
      }
    }
    return result;
  });
  console.log('Travel:',JSON.stringify(report.travel));
  for(const id of ['midio','broshi','midasus']){
    assert.ok(report.travel.after.energetic[id]>report.travel.before.energetic[id]*2,`${id}: music must move more than the old slow loops`);
    assert.ok(report.travel.after.energetic[id]>report.travel.after.quiet[id]*1.15,`${id}: actual energetic audio must move more than calm audio`);
  }
  // At a single camera/time, substitute only each resident's geometry pose
  // 160ms later. Keep lights/glow untouched so brightness cannot pass as motion.
  report.pixels=await page.evaluate(async()=>{
    const app=window.__SMW,pres=app.sim.biomes.rangePresentation;
    const prepared=pres.scene.prepared.get(app.rangeState.viewId),habitat=prepared.habitat;
    const {sampleRangePerformance}=await import('/src/world/alpine/RangePerformance.js');
    const original=habitat.snapshot,update=habitat.update;
    const timeMs=original.timeMs+160;
    const next=sampleRangePerformance({layout:prepared.habitatLayout,timeMs,music:app.sim.biomes.ridgeMusicSession.sample(timeMs)});
    const canvas=document.querySelector('#stage'),ctx=canvas.getContext('2d');
    const before=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const result={};
    const diff=()=>{
      const after=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let changed=0,sky=0,lake=0;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4;
        if(Math.max(...[0,1,2].map(c=>Math.abs(before[i+c]-after[i+c])))<6)continue;
        changed++;if(y<canvas.height*.25)sky++;if(y>canvas.height*.75)lake++;
      }
      return {changed,sky,lake};
    };
    try{
      for(const id of ['midio','broshi','midasus']){
        const later=next.actors.find(a=>a.id===id);
        const pose={...original,actors:original.actors.map(a=>a.id===id?{...later,glow:a.glow}:a)};
        habitat.update=()=>update.call(habitat,pose);
        app.renderExportFrame(app.sim.timeMs);result[id]=diff();
      }
    }finally{habitat.update=update;app.renderExportFrame(app.sim.timeMs);}
    const vector=prepared.uniforms.uFirmamentMotion.value,set=vector.set;
    try{
      vector.set=function(x,y,z,w){return set.call(this,0,0,0,w);};
      app.renderExportFrame(app.sim.timeMs);result.curtain=diff();
    }finally{vector.set=set;app.renderExportFrame(app.sim.timeMs);}
    return result;
  });
  console.log('Fixed camera, 160ms body motion and curtain music on/off:',JSON.stringify(report.pixels));
  for(const id of ['midio','broshi','midasus'])assert.ok(report.pixels[id].changed>40,`${id} must visibly move within 160ms`);
  assert.ok(report.pixels.curtain.sky>500&&report.pixels.curtain.lake>500,'curtain movement reaches both sky and reflected sky');
  for(let i=0;i<frameCount;i++){
    const frame=await captureFrame(page,startMs+i*1000/fps);
    assert.equal(frame.range.mode,'v2');
    await fs.writeFile(path.join(out,'frames',`${String(i).padStart(3,'0')}.png`),Buffer.from(frame.png,'base64'));
    report.frames.push(await read(page));
    if(i%12===0)console.log(`Animation: ${i}/${frameCount}`);
  }
  execFileSync('ffmpeg',['-y','-framerate',String(fps),'-i',path.join(out,'frames','%03d.png'),
    '-vf','split[a][b];[a]palettegen[p];[b][p]paletteuse','-loop','0',path.join(out,'musical-energy.gif')],{stdio:'ignore'});
  execFileSync('ffmpeg',['-y','-framerate',String(fps),'-i',path.join(out,'frames','%03d.png'),
    '-ss',String(startMs/1000),'-i',wav,'-t',String(frameCount/fps),'-c:v','libx264','-pix_fmt','yuv420p',
    '-c:a','aac','-movflags','+faststart',path.join(out,'musical-energy.mp4')],{stdio:'ignore'});
  await page.evaluate(async t=>{window.__SMW.seek(t);await window.__SMW.rangeReady({timeoutMs:600000});},startMs);
  await captureFrame(page,startMs);near(spatial(await read(page)),spatial(original));
  const held=await read(page);await captureFrame(page,startMs);assert.deepEqual(await read(page),held);
  report.seekAndPause=true;
  await page.evaluate(()=>window.__SMW.sim.setReducedMotion(true));
  await captureFrame(page,startMs);const a=await read(page);
  await captureFrame(page,startMs+200);const b=await read(page);
  assert.deepEqual(spatial(a),spatial(b));assert.deepEqual(a.camera,b.camera);assert.equal(b.curtain[3],0);
  report.reducedMotion=true;
  report.browserErrors=opened.errors;assert.deepEqual(opened.errors,[]);
  assert.deepEqual(await identity(),report.sourceHashes);
  report.passed=true;
  await opened.context.close();
}catch(error){report.error=String(error.stack||error);throw error;}
finally{await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
