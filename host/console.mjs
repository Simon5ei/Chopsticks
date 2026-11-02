const endpoints=new Set(['overview','events','traces','logs']);
export function registerConsole(ctx,runtime){
 if(typeof ctx.inject!=='function')return;
 return ctx.inject(['connection'],host=>host.connection.fetch.register({path:'/api/chopsticks-console',methods:['POST'],requestBody:'buffered',async fetch(request){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return new Response('JSON required',{status:415});
  let envelope;try{envelope=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
  if(envelope?.type!=='client-request'||typeof envelope.rpcId!=='string'||envelope.rpcId.length>512||envelope.method!=='chopsticks-console')return new Response('Invalid RPC request',{status:400});
  let result;try{const {endpoint,payload={}}=envelope.payload||{};if(!endpoints.has(endpoint))throw Error('Unknown console endpoint');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid query');result={ok:true,value:await runtime.queryConsole(endpoint,payload)};}catch{result={ok:false,error:{message:'Console query unavailable or invalid'}};}
  return Response.json({type:'server-response',rpcId:envelope.rpcId,result});
 }}));
}
