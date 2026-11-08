import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Execute the actual registration expression without booting platform transports.
// The optional native check uses the installed DSH compiler, not a copied DSL.
function registeredParameters(){
 const source=fs.readFileSync(new URL('../src/host/index.mjs',import.meta.url),'utf8');
 const ast=ts.createSourceFile('host.mjs',source,ts.ScriptTarget.Latest,true);
 let helper: string,registration: string;
 function visit(node: ts.Node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='str'))helper=node.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='add'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='chopsticks_evolution_report')registration=node.getText(ast)+';';
  ts.forEachChild(node,visit);
 }
 visit(ast);
 assert.ok(helper&&registration,'evolution report registration must be discoverable');
 let parameters;
 vm.runInNewContext(`${helper}\n${registration}`,{add:(_name?: any,_description?: any,value?: any)=>{parameters=value;}});
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
 const extra=structuredClone(valid);(extra.facts[0] as any).unexpected=true;assert.ok(native.validateJsonSchemaValue(schema,extra).length);
});
