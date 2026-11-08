import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

// Execute the actual registration expression without booting platform transports.
// The optional native check uses the installed DSH compiler, not a copied DSL.
function registeredParameters(){
 const source=fs.readFileSync(new URL('../host/index.mjs',import.meta.url),'utf8');
 const helper=source.match(/^ const str=.*$/m)?.[0];
 const registration=source.match(/^ add\('chopsticks_evolution_report'.*$/m)?.[0];
 assert.ok(helper&&registration,'evolution report registration must be discoverable');
 let parameters;
 vm.runInNewContext(`${helper}\n${registration}`,{add:(_name,_description,value)=>{parameters=value;}});
 return JSON.parse(JSON.stringify(parameters));
}

test('evolution report registers closed nested objects with native DSH required properties',()=>{
 const parameters=registeredParameters();
 for(const [name,required] of Object.entries({facts:['text','sourceEventIds'],hypotheses:['text','sourceEventIds'],relationships:['from','to','relation','certainty','sourceEventIds']})){
  const item=parameters[name].items;
  assert.equal(item.additionalProperties,false,`${name} nested object must be closed`);
  assert.equal(Object.hasOwn(item,'required'),false,`${name} cannot use a JSON Schema required array in DSH DSL`);
  for(const key of required)assert.equal(item.properties[key].required,true,`${name}.${key} must remain required`);
 }
 assert.equal(parameters.facts.required,true);
 assert.equal(parameters.hypotheses.required,undefined);
 assert.equal(parameters.relationships.required,undefined);
});

test('installed DSH compiler accepts evolution report and enforces required nested fields',{skip:!process.env.DSH_RUNTIME_PACKAGE},()=>{
 const native=createRequire(process.env.DSH_RUNTIME_PACKAGE)('@deepseek-ai/dsh-tools');
 const schema=native.parameterSchemaSpecToJsonSchema(registeredParameters());
 const valid={scope:'public',facts:[{text:'observed',sourceEventIds:['event-1']}],relationships:[{from:'fish',to:'42',relation:'talked',certainty:'observed',sourceEventIds:['event-1']}]};
 assert.deepEqual(native.validateJsonSchemaValue(schema,valid),[]);
 for(const field of ['text','sourceEventIds']){const bad=structuredClone(valid);delete bad.facts[0][field];assert.ok(native.validateJsonSchemaValue(schema,bad).length);}
 for(const field of ['from','to','relation','certainty','sourceEventIds']){const bad=structuredClone(valid);delete bad.relationships[0][field];assert.ok(native.validateJsonSchemaValue(schema,bad).length);}
 const extra=structuredClone(valid);extra.facts[0].unexpected=true;assert.ok(native.validateJsonSchemaValue(schema,extra).length);
});
