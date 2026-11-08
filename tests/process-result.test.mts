import test from 'node:test';
import assert from 'node:assert/strict';
import {commandExitStatus} from '../scripts/process-result.mjs';

test('test command fails closed for killed, timed out and failed child processes',()=>{
 for(const signal of ['SIGTERM','SIGKILL'])assert.equal(commandExitStatus({status:null,signal}),1);
 assert.equal(commandExitStatus({status:null,error:new Error('deadline')}),1);
 assert.equal(commandExitStatus({status:2}),2);
 assert.equal(commandExitStatus({status:0}),0);
});
