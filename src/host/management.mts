import fs from 'node:fs';

// Exact asset routes inherit the DSH connection's authenticated HTTP boundary.
export function registerManagement(ctx?: any,contentObservations?: {recap:(scope:string,day?:string)=>unknown}){
 if(typeof ctx.inject!=='function')return;
 return ctx.inject(['connection'],(host)=>{
  const disposers=[];
  for(const [route,file,type] of [
   ['/api/chopsticks','index.html','text/html'],
   ['/api/chopsticks/relationships.js','relationships.js','text/javascript'],
   ['/api/chopsticks/relationships.css','relationships.css','text/css'],
   ['/api/chopsticks/layout.js','layout.js','text/javascript'],
   ['/api/chopsticks/pipeline','pipeline.html','text/html'],
   ['/api/chopsticks/pipeline.js','pipeline.js','text/javascript'],
   ['/api/chopsticks/pipeline.css','pipeline.css','text/css'],
   ['/api/chopsticks/mood','mood.html','text/html'],
   ['/api/chopsticks/mood.js','mood.js','text/javascript'],
   ['/api/chopsticks/mood.css','mood.css','text/css'],
   ['/api/chopsticks/prompts','prompts.html','text/html'],
   ['/api/chopsticks/prompts.js','prompts.js','text/javascript'],
   ['/api/chopsticks/prompts.css','prompts.css','text/css'],
  ]){
   const body=fs.readFileSync(new URL('../console/management/'+file,import.meta.url));
   disposers.push(host.connection.fetch.register({path:route,methods:['GET'],requestBody:'buffered',fetch:()=>new Response(body,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; object-src 'none'"}})}));
  }
  if(contentObservations)disposers.push(host.connection.fetch.register({
   path:'/api/chopsticks/content-recap',methods:['GET'],requestBody:'buffered',
   fetch(request: Request){
    const query=new URL(request.url).searchParams;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if([...query.keys()].some(k=>!['scope','date'].includes(k))||query.getAll('scope').length>1||query.getAll('date').length>1)
     return Response.json({error:'Invalid recap query'},{status:400,headers});
    try{return Response.json(contentObservations.recap(query.get('scope')??'public',query.get('date')??undefined),{headers});}
    catch{return Response.json({error:'Invalid recap scope or date'},{status:400,headers});}
   }
  }));
  return ()=>disposers.forEach((dispose)=>typeof dispose==='function'&&dispose());
 });
}
