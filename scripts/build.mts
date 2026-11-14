import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
// Only this generated directory is removable; never follow links into state.
if(fs.existsSync(dist)&&fs.lstatSync(dist).isSymbolicLink())throw Error('Refusing linked build directory');
fs.rmSync(dist,{recursive:true,force:true});
const result=spawnSync(process.execPath,['--max-old-space-size=640',path.join(root,'node_modules/typescript/bin/tsc')],{cwd:root,stdio:'inherit',timeout:180000,windowsHide:true});
if(result.error)console.error(result.error.message);
if(result.signal)console.error(`Compiler terminated: ${result.signal}`);
if(result.error||result.status!==0)process.exit(result.status||1);
let count=0,bytes=0;
function copyTree(from:string,to:string,filter:(file:string)=>boolean){
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  if(++count>3000)throw Error('Build file bound exceeded');
  const source=path.join(from,entry.name),target=path.join(to,entry.name);
  if(entry.isSymbolicLink())throw Error('Build inputs must not be symlinks');
  if(entry.isDirectory()){copyTree(source,target,filter);continue;}
  if(!filter(source))continue;
  const size=fs.statSync(source).size;bytes+=size;
  if(size>2*1024*1024||bytes>24*1024*1024)throw Error('Build byte bound exceeded');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
 }
}
copyTree(path.join(root,'src'),path.join(dist,'src'),file=>! /\.(mts|ts|mjs|cjs|js)$/.test(file));
// DSH and the owner-only management pages load classic scripts. TypeScript
// checks each browser file as its own module; only its empty marker is erased.
for(const file of ['client.js','management/layout.js','management/mood.js','management/pipeline.js','management/prompts.js','management/relationships.js']){
 const target=path.join(dist,'src/console',file);
 const source=fs.readFileSync(target,'utf8').replace(/^export \{\};\r?\n/gm,'');
 if(/^\s*(?:import|export)\s/m.test(source))throw Error('Browser assets must remain classic scripts');
 fs.writeFileSync(target,source);
}
copyTree(path.join(root,'presets'),path.join(dist,'presets'),()=>true);
const release=path.join(dist,'release');
copyTree(path.join(dist,'src'),release,()=>true);
copyTree(path.join(root,'presets'),path.join(release,'presets'),()=>true);
copyTree(path.join(root,'notices'),path.join(release,'notices'),()=>true);
for(const name of ['LICENSE','NOTICE.md','package-lock.json'])fs.copyFileSync(path.join(root,name),path.join(release,name));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
pkg.main=pkg.main.replace('./dist/src/','./');
pkg.exports=Object.fromEntries(Object.entries(pkg.exports).map(([key,value])=>[key,String(value).replace('./dist/src/','./')]));
delete pkg.scripts;delete pkg.devDependencies;
fs.writeFileSync(path.join(release,'package.json'),JSON.stringify(pkg,null,2)+'\n');
// Local compiled execution has the same source-inventory root as a release.
fs.writeFileSync(path.join(dist,'src/package.json'),JSON.stringify(pkg,null,2)+'\n');
fs.copyFileSync(path.join(root,'package-lock.json'),path.join(dist,'src/package-lock.json'));
copyTree(path.join(root,'presets'),path.join(dist,'src/presets'),()=>true);
console.log(`Built TypeScript and release (${count} entries, ${bytes} bytes copied)`);
