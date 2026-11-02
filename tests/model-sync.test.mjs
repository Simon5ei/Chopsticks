import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeSessionModels} from '../host/model-sync.mjs';
test('model changes update every adopted session, retry partial failures, and do not recreate histories',async()=>{
 const values=new Map(),state={get:(k,id)=>values.get(k+id),put:(k,id,v)=>values.set(k+id,v)};
 const selected=[];let fail=true;const controller={selectModel:async args=>{if(args.sessionId==='bili'&&fail)throw Error('temporary restore failure');selected.push(args);}};
 const options={controller,state,sessionIds:['qq1','qq2','bili','qq1'],model:{provider:'deepseek-official',model:'deepseek-flash'}};
 await assert.rejects(synchronizeSessionModels(options));assert.equal(values.size,0);
 fail=false;const result=await synchronizeSessionModels(options);assert.equal(result.sessions,3);
 const count=selected.length;await synchronizeSessionModels(options);assert.equal(selected.length,count);
 await synchronizeSessionModels({...options,model:{provider:'deepseek-official',model:'next'}});assert.equal(selected.length,count+3);
});
