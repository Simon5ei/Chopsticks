import fs from 'node:fs';

// Exact asset routes inherit the DSH connection's authenticated HTTP boundary.
export function registerManagement(ctx){
 if(typeof ctx.inject!=='function')return;
 return ctx.inject(['connection'],host=>{
  const disposers=[];
  for(const [route,file,type] of [
   ['/api/chopsticks','index.html','text/html'],
   ['/api/chopsticks/relationships.js','relationships.js','text/javascript'],
   ['/api/chopsticks/relationships.css','relationships.css','text/css'],
   ['/api/chopsticks/layout.js','layout.js','text/javascript'],
   ['/api/chopsticks/mood','mood.html','text/html'],
   ['/api/chopsticks/mood.js','mood.js','text/javascript'],
   ['/api/chopsticks/mood.css','mood.css','text/css'],
  ]){
   const body=fs.readFileSync(new URL('../console/management/'+file,import.meta.url));
   disposers.push(host.connection.fetch.register({path:route,methods:['GET'],requestBody:'buffered',fetch:()=>new Response(body,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; object-src 'none'"}})}));
  }
  return ()=>disposers.forEach(dispose=>typeof dispose==='function'&&dispose());
 });
}
