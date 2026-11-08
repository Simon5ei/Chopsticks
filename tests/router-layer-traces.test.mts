import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createObservability} from '../src/host/observability.mjs';
test('domain Router navigation shows its actual reasoning and source events without mixing other layers',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-traces-')),traces=createObservability({stateDir:dir});t.after(()=>{traces.close();fs.rmSync(dir,{recursive:true,force:true});});
 traces.record({kind:'reasoning',sessionId:'chopsticks-router-chat-run',eventId:'chat-event',layer:'chat',text:'chat reasoning'});
 traces.record({kind:'reasoning',sessionId:'chopsticks-router-surf-run',eventId:'surf-event',layer:'surf',text:'surf reasoning'});
 assert.deepEqual(traces.query({sessionId:'chopsticks-router:chat'},false,true).items.map((r)=>r.text),['chat reasoning']);
 assert.deepEqual(traces.eventIds('chopsticks-router:surf'),['surf-event']);
 assert.equal(traces.query({sessionId:'chopsticks-router'},false,true).items.length,2,'overall view keeps full coordinator roll-up');
});
