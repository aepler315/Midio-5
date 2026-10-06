import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { stageSite, assertStagePaths, assertRegularTree, verifyRangeRuntime } from './stage-site.mjs';
import { adaptVersion, fileHash } from './lib/version-adapters.mjs';

const exec = promisify(execFile);
export const MAX_SITE_BYTES = 838860800;
const SHARED_FILES = ['VersionCatalog.js','VersionHandoff.js','VersionNavigation.js','VersionBootstrap.js','version-navigation.css'].map(name=>`src/ui/${name}`);
const PUBLIC_PATHS = ['index.html','src','soundfonts'];
const publicPath = (name) => name === 'index.html' || name.startsWith('src/') || name.startsWith('soundfonts/');
const safePath = (name) => !name.startsWith('/') && !name.includes('\\') && !name.split('/').some(p=>p==='..'||p==='.'||p==='');

async function readTree(root, prefix = '') {
  const files = new Map();
  for (const name of (await fs.readdir(path.join(root,prefix))).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = await fs.lstat(path.join(root,rel));
    if (stat.isDirectory()) for(const [p,b] of await readTree(root,rel)) files.set(p,b);
    else if(stat.isFile()) files.set(rel,await fs.readFile(path.join(root,rel)));
    else throw new Error(`Output must contain only regular files: ${rel}`);
  }
  return files;
}
async function writeTree(root, files) {
  for(const [name,bytes] of files) {
    if(!safePath(name)||!publicPath(name)) throw new Error(`Unsafe public path: ${name}`);
    await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});
    await fs.writeFile(path.join(root,name),bytes);
  }
}
function validateCheckpoints(checkpoints, liveId) {
  const ids = new Set();
  if(!Array.isArray(checkpoints)||checkpoints.length<2) throw new Error('At least two checkpoints required');
  for(const c of checkpoints) {
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)||ids.has(c.id)) throw new Error('Invalid or duplicate checkpoint id');
    if(!/^[a-f0-9]{40}$/.test(c.sourceSha)) throw new Error('Invalid checkpoint source SHA');
    if(typeof c.label!=='string'||!c.label||!Number.isInteger(c.sourcePr)||c.sourcePr<1) throw new Error('Invalid checkpoint metadata');
    ids.add(c.id);
  }
  if(!ids.has(liveId)) throw new Error('Live checkpoint is missing');
}
async function extractPinned(source, sha, workspace) {
  // Git objects must already be available. Staging never fetches the network.
  await exec('git',['-C',source,'cat-file','-e',`${sha}^{commit}`]);
  const {stdout} = await exec('git',['-C',source,'ls-tree','-rz',sha,'--',...PUBLIC_PATHS],{encoding:'buffer',maxBuffer:16*1024*1024});
  for(const item of stdout.toString('utf8').split('\0').filter(Boolean)) {
    const match=/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(item);
    if(!match||!safePath(match[4])||!publicPath(match[4])) throw new Error('Unsafe public git tree path');
    if(!['100644','100755'].includes(match[1])||match[2]!=='blob') throw new Error(`Public git tree symlink/non-regular file: ${match[4]}`);
  }
  const archive = path.join(workspace,'source.tar');
  const extracted = path.join(workspace,'public');
  await fs.mkdir(extracted);
  await exec('git',['-C',source,'archive','--format=tar',`--output=${archive}`,sha,'--',...PUBLIC_PATHS]);
  await exec('tar',['-xf',archive,'-C',extracted]);
  await fs.rm(archive);
  await assertRegularTree(extracted);
  for(const required of ['index.html','src/main.js','soundfonts']) await fs.access(path.join(extracted,required));
  return extracted;
}

export async function stageVersions({ sourceDir, outputDir, checkpoints, liveId, budgetBytes=MAX_SITE_BYTES, adapterProfiles, sharedFiles=SHARED_FILES }) {
  if(!Number.isSafeInteger(budgetBytes)||budgetBytes<1||budgetBytes>MAX_SITE_BYTES) throw new Error('Invalid site budget');
  if(!checkpoints||!liveId) {
    const catalog=await import('./version-checkpoints.mjs');
    checkpoints ??= catalog.CHECKPOINTS; liveId ??= catalog.LIVE_ID;
  }
  validateCheckpoints(checkpoints,liveId);
  const {source,output}=await assertStagePaths(sourceDir,outputDir);
  const {stdout:buildSha}=await exec('git',['-C',source,'rev-parse','HEAD']);
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'midio-version-stage-'));
  const staged=path.join(workspace,'site');
  try {
    await stageSite(source,staged);
    const shared=new Map();
    for(const file of sharedFiles) {
      if(!safePath(file)||!publicPath(file)) throw new Error('Unsafe shared navigation path');
      await assertRegularTree(path.join(source,file));
      shared.set(file,await fs.readFile(path.join(source,file)));
    }
    const report={schema:1,buildSha:buildSha.trim(),liveId,totalBytes:0,budgetBytes,entries:[]};
    const manifest={schema:1,buildSha:buildSha.trim(),liveId,entries:checkpoints.map(c=>({id:c.id,label:c.label,sourceSha:c.sourceSha,sourcePr:c.sourcePr,entryPath:c.id===liveId?'./':`versions/${c.id}/`,live:c.id===liveId}))};
    for(const c of checkpoints) {
      const entryPath=c.id===liveId?'./':`versions/${c.id}/`;
      let original, adapted, runtime;
      if(c.id===liveId) {
        const scratch=path.join(workspace,c.id);await fs.mkdir(scratch);
        const extracted=await extractPinned(source,c.sourceSha,scratch);
        original=await readTree(extracted);
        const liveFiles=new Map([...await readTree(staged)].filter(([file])=>publicPath(file)||['CNAME','.nojekyll'].includes(file)));
        const allowed=new Set(['index.html','src/main.js','src/ui/style.css',...sharedFiles]);
        const transformations=[];
        for(const [file,bytes] of liveFiles) {
          const before=original.get(file);
          if(before&&fileHash(before)===fileHash(bytes)) continue;
          if(!allowed.has(file)&&!['CNAME','.nojekyll'].includes(file)) throw new Error(`Live checkpoint runtime drift outside navigation compatibility: ${file}`);
          transformations.push({path:file,name:before?'live navigation/session integration':'live root/navigation addition',count:1,sourceHash:before?fileHash(before):null,outputHash:fileHash(bytes)});
        }
        for(const file of original.keys()) if(!liveFiles.has(file)) throw new Error(`Live checkpoint pinned runtime file is missing: ${file}`);
        adapted={files:liveFiles,transformations};
        runtime={checked: !!liveFiles.has('src/vendor/range/runtime.json')};
        await fs.rm(scratch,{recursive:true,force:true});
      } else {
        const scratch=path.join(workspace,c.id);await fs.mkdir(scratch);
        const extracted=await extractPinned(source,c.sourceSha,scratch);
        runtime=await verifyRangeRuntime(extracted,extracted);
        original=await readTree(extracted);
        adapted=adaptVersion({sourceSha:c.sourceSha,checkpointId:c.id,files:original,siteRootRelative:'../../',profiles:adapterProfiles,liveId});
        for(const [file,bytes] of shared) {
          const before=adapted.files.get(file);
          adapted.files.set(file,bytes);
          adapted.transformations.push({path:file,name:'shared navigation module',count:1,sourceHash:before?fileHash(before):null,outputHash:fileHash(bytes)});
        }
        await writeTree(path.join(staged,entryPath),adapted.files);
        await fs.rm(scratch,{recursive:true,force:true});
      }
      report.entries.push({id:c.id,sourceSha:c.sourceSha,entryPath,runtime,transformations:adapted.transformations,files:[...adapted.files].map(([p,b])=>({path:p,sourceHash:original.has(p)?fileHash(original.get(p)):null,outputHash:fileHash(b),bytes:b.byteLength}))});
      if((await treeBytes(staged))>budgetBytes) throw new Error('Complete staged site exceeds budget');
    }
    await fs.mkdir(path.join(staged,'versions'),{recursive:true});
    await fs.writeFile(path.join(staged,'versions/manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
    const reportPath=path.join(staged,'versions/build-report.json');
    for(let i=0;i<4;i++) {
      await fs.writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`);
      const total=await treeBytes(staged);if(total===report.totalBytes) break;report.totalBytes=total;
    }
    if(report.totalBytes>budgetBytes) throw new Error('Complete staged site exceeds budget');
    await fs.rm(output,{recursive:true,force:true});
    await fs.mkdir(output,{recursive:true});
    await fs.cp(staged,output,{recursive:true});
    return report;
  } finally { await fs.rm(workspace,{recursive:true,force:true}); }
}
async function treeBytes(root) {
  let bytes=0;
  for(const name of await fs.readdir(root)) {
    const file=path.join(root,name);const stat=await fs.lstat(file);
    if(stat.isDirectory()) bytes+=await treeBytes(file);
    else if(stat.isFile()) bytes+=stat.size;
    else throw new Error('Staged output contains a non-regular file');
  }
  return bytes;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  stageVersions({sourceDir:process.argv[2]||'.',outputDir:process.argv[3]||'_site'}).then(report=>console.log(`Staged ${report.entries.length} checkpoints (${report.totalBytes} bytes)`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
