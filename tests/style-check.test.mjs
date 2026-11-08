import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const url=new URL('../host/style-check.mjs',import.meta.url);
const module=fs.existsSync(url)?await import(url):{};
const qq={role:'qq',channel:'g:1001'};
const check=(caller,args)=>{assert.equal(typeof module.checkStyle,'function','Draft checker must be available');return module.checkStyle(caller,args);};

test('draft diagnostics distinguish hard evidence from ordinary speech and quoted examples',()=>{
 for(const text of ['今天想吃白饭，谁一起？','这活干得漂亮','他说：“我记下了”，然后离开了。','> 收到主人\n这是引用。','1. 我记下了\n2. 收到主人\n3. 这是本鱼最喜欢的一句话']){
  const result=check(qq,{text});assert.equal(result.flagged,false,text);assert.deepEqual(result.hard,[]);
 }
 const result=check(qq,{text:'收到主人'});assert.equal(result.flagged,true);assert.deepEqual(result.hard,['hard:收到主人']);assert.equal(result.advisory,true);assert.equal(result.historyCompared,false);assert.deepEqual(result.repeats,[]);assert.equal('text' in result,false);assert.equal('sent' in result,false);
 const soft=check(qq,{text:'总之，本质上值得一提的是希望对你有帮助。'});assert.equal(soft.flagged,true);assert.ok(soft.soft.length>=2);assert.deepEqual(soft.hard,[]);
});

test('only the bounded draft is accepted, without caller-supplied history or whitespace',()=>{
 for(const args of [null,[],{}, {text:1},{text:' \n　'},{text:'字'.repeat(2001)},{text:'🐟'.repeat(2001)},{text:'草稿',own:['过去的消息']},{text:'草稿',channel:'p:2002'}])assert.throws(()=>check(qq,args));
 assert.equal(check(qq,{text:'字'.repeat(2000)}).checkedLength,2000);
 assert.equal(check(qq,{text:'🐟'.repeat(2000)}).checkedLength,2000);
});

test('non-QQ callers fail even when guessing the tool name',()=>{
 for(const role of ['router','bili','worker','development','unknown'])assert.throws(()=>check({role,channel:'g:1001'},{text:'草稿'}),/QQ/);
 assert.throws(()=>check({role:'qq',channel:'bili:public'},{text:'草稿'}),/QQ/);
});

test('the rule closure can import and evaluate without filesystem, network or host capabilities',()=>{
 assert.ok(fs.existsSync(url),'Draft checker must be available');
 const box={exports:{}};
 const ruleSource=fs.readFileSync(new URL('../style/vendor/fishrules.cjs',import.meta.url),'utf8');
 vm.runInNewContext(ruleSource,{module:box},{codeGeneration:{strings:false,wasm:false}});
 const source=fs.readFileSync(url,'utf8').replace(/^import .*;\r?\n/m,'').replaceAll('export ','');
 const context=vm.createContext({rules:box.exports},{codeGeneration:{strings:false,wasm:false}});
 const result=vm.runInContext(source+'\ncheckStyle({role:"qq",channel:"p:1001"},{text:"收到主人"});',context);
 assert.equal(result.flagged,true);assert.equal(result.historyCompared,false);
});
