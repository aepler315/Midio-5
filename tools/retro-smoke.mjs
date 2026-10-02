// Pixel presentation through real title controls, playback, export and reload.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const server = spawn(process.execPath, ['tools/serve.js', '8089'], { stdio: 'ignore' });
let browser;
try {
  for (let i=0;i<50;i++) { try { if ((await fetch('http://127.0.0.1:8089')).ok) break; } catch { /* startup */ } await new Promise(r=>setTimeout(r,100)); }
  execFileSync(process.execPath,['tools/gen-test-wav.mjs','/tmp/midio-retro.wav','120','40']);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, headless: true, args: ['--in-process-gpu','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport:{width:1000,height:700}, serviceWorkers: 'block' });
  await page.route(/^https:\/\//, route => route.abort());
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8089/?rangeRenderer=legacy');
  await page.locator('#titleSettings').evaluate(n=>{n.open=true;});
  await page.selectOption('#display-look','palette');
  await page.waitForTimeout(300);
  const title = await page.evaluate(()=>window.__SMW.presentationDiagnostics);
  assert.deepEqual(title.working,{width:320,height:180}); assert.equal(title.effectiveLook,'palette');
  await page.reload();
  assert.equal(await page.locator('#display-look').inputValue(),'palette');
  await page.locator('#titleSettings').evaluate(n=>{n.open=true;});
  await page.locator('#lyricGroundingBtn').evaluate(n=>{ if(n.getAttribute('aria-pressed')==='true') n.click(); });
  await page.locator('#fileInput').setInputFiles('/tmp/midio-retro.wav');
  await page.waitForFunction(()=>!!window.__SMW?.sim);
  await page.locator('#stage').click({position:{x:50,y:50}});
  await page.locator('#displaySettingsBtn').focus();
  await page.keyboard.press('Enter');
  await page.selectOption('#display-look','pixel');
  await page.selectOption('#display-quality','economy');
  await page.selectOption('#display-scaling','integer');
  await page.locator('#displaySettingsClose').click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__SMW.perfLevel),6);
  await page.waitForFunction(()=> { try { window.__SMW.beginBulkExport({width:800,height:480}); return true; } catch { return false; } }, null, {timeout:120000});
  const frames=[];
  for (const [width,height] of [[800,480],[1080,1080],[1080,1920],[160,90]]) {
    frames.push(await page.evaluate(({width,height})=>{
      let a=window.__SMW;
      a.beginBulkExport({width,height,presentation:{version:1,look:'palette',quality:'economy',palette:'range32',dither:.35,scaling:'integer'}});
      a=window.__SMW;
      a.renderExportFrame(250);a.renderExportFrame(20000);
      const c=document.querySelector('#stage'),ctx=c.getContext('2d'),px=ctx.getImageData(0,0,width,height).data;
      const colors=new Set();for(let i=0;i<px.length;i+=4) colors.add(`${px[i]},${px[i+1]},${px[i+2]}`);
      return {width,height,diag:a.presentationDiagnostics,quality:a.perfLevel,colors:colors.size,png:c.toDataURL('image/png').split(',')[1]};
    },{width,height}));
    const f=frames.at(-1);
    assert.deepEqual(f.diag.working,{width:320,height:180});assert.equal(f.diag.paletteStatus.pixels,57600);
    assert.equal(f.quality,6); assert.ok(f.colors<=32,`${width}x${height}: ${f.colors} colors`);
  }
  assert.deepEqual(errors,[]);
  const out='docs/evidence/pixel-storm-peaks';await fs.mkdir(out,{recursive:true});
  for (const f of frames) {await fs.writeFile(`${out}/palette-${f.width}x${f.height}.png`,Buffer.from(f.png,'base64'));delete f.png;}
  await fs.writeFile(`${out}/pixel-manifest.json`,JSON.stringify({title,frames,errors},null,2));
  console.log('PASS title, persisted preferences, playback controls, Economy, four bounded palette export sizes');
} finally { await browser?.close();server.kill(); }
