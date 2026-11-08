import {hash} from './state.mjs';
// Native selection preserves the full session log. Never edit old model events.
export async function synchronizeSessionModels({controller,state,sessionIds,model}: { controller?: any; state?: any; sessionIds?: any; model?: any; [key: string]: any }){
 if(!model?.provider||!model?.model)return {sessions:0,changed:false};
 const ids=[...new Set<any>(sessionIds)].sort();const signature=hash({ids,model});
 if(state.get('deployment','model-selection')?.signature===signature)return {sessions:ids.length,changed:false};
 for(const sessionId of ids)await controller.selectModel({sessionId,...model});
 const result={signature,model,sessions:ids.length,at:new Date().toISOString()};
 state.put('deployment','model-selection',result);return {...result,changed:true};
}
