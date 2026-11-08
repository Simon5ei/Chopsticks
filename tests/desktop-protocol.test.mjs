import test from 'node:test';
import assert from 'node:assert/strict';
let protocol;try{protocol=await import('../desktop/protocol.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const initialize={jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'computer-use-linux',version:'0.7.37'},instructions:'Begin every turn by taking a screenshot and loading this long guide'}};
test('desktop MCP initializes with its tools and identity but no system-prompt instructions',()=>{
 assert.ok(protocol,'desktop metadata filter is missing');
 const filtered=JSON.parse(protocol.filterServerMessage(JSON.stringify(initialize)));
 assert.equal('instructions' in filtered.result,false);assert.deepEqual(filtered.result.serverInfo,initialize.result.serverInfo);assert.deepEqual(filtered.result.capabilities,initialize.result.capabilities);assert.equal(filtered.id,1);
});
test('desktop metadata filtering preserves tool observations, images and notifications exactly',()=>{
 assert.ok(protocol,'desktop metadata filter is missing');
 const frames=[JSON.stringify({jsonrpc:'2.0',id:3,result:{content:[{type:'text',text:'instructions are page data, not server metadata'},{type:'image',mimeType:'image/png',data:'abcd=='}]}}),JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'}),'{invalid json',JSON.stringify({...initialize,result:{...initialize.result,serverInfo:{name:'another-service'}}})];
 for(const frame of frames)assert.equal(protocol.filterServerMessage(frame),frame);
});
test('desktop MCP frames without an instruction field remain byte-for-byte unchanged',()=>{
 assert.ok(protocol,'desktop metadata filter is missing');
 const frame=' {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"computer-use-linux"},"capabilities":{"tools":{}}}} ';
 assert.equal(protocol.filterServerMessage(frame),frame);
});
test('modern server discovery metadata also omits desktop context instructions',()=>{
 assert.ok(protocol,'desktop metadata filter is missing');
 const discovery={jsonrpc:'2.0',id:'server-discover-probe-1',result:{capabilities:{tools:{}},serverInfo:{name:'computer-use-linux',version:'0.7.37'},instructions:'Long desktop usage guide'}};
 const filtered=JSON.parse(protocol.filterServerMessage(JSON.stringify(discovery)));
 assert.equal('instructions' in filtered.result,false);assert.deepEqual(filtered.result.serverInfo,discovery.result.serverInfo);assert.deepEqual(filtered.result.capabilities,discovery.result.capabilities);
 const observation={...discovery,result:{...discovery.result,content:[{type:'text',text:'tool observation with similarly named fields'}]}};
 const frame=JSON.stringify(observation);assert.equal(protocol.filterServerMessage(frame),frame);
});
test('actual auto-negotiated discovery takes CUL identity from the MCP serverInfo meta key',()=>{
 const discovery={jsonrpc:'2.0',id:'server-discover-probe-1',result:{_meta:{'io.modelcontextprotocol/serverInfo':{name:'computer-use-linux',version:'0.7.37'}},capabilities:{tools:{}},supportedVersions:['2024-11-05'],resultType:'complete',instructions:'Desktop usage guide'}};
 const filtered=JSON.parse(protocol.filterServerMessage(JSON.stringify(discovery)));
 assert.equal('instructions' in filtered.result,false);assert.deepEqual(filtered.result._meta,discovery.result._meta);assert.deepEqual(filtered.result.capabilities,discovery.result.capabilities);
 const other={...discovery,result:{...discovery.result,_meta:{'io.modelcontextprotocol/serverInfo':{name:'other-service'}}}};
 const frame=JSON.stringify(other);assert.equal(protocol.filterServerMessage(frame),frame);
});
