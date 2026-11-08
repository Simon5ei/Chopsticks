import {readFile,writeFile,copyFile,chmod,mkdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

// Operator-only enrichment. The official page runs its own device SDK; this
// helper neither creates risk tokens nor accesses any other browser profile.
export async function acquireHeyboxWebsiteSession({stateDir,executablePath,chromium,headless=true,signal,verify}: { stateDir?: any; executablePath?: any; chromium?: any; headless?: boolean; signal?: any; verify?: any; [key: string]: any }={}) {
 if(!stateDir||!executablePath)return {state:'refused',code:'browser_configuration_required'};
 const authPath=join(stateDir,'auth.json'),temporary=join(stateDir,'auth-website.tmp');let browser;
 try {
  if(signal?.aborted)return {state:'cancelled'};
  const original=JSON.parse(await readFile(authPath,'utf8'));
  const accountId=String(original.cookies?.heybox_id||original.cookies?.user_heybox_id||'');
  if(!accountId||!(original.cookies.pkey||original.cookies.user_pkey))return {state:'login_required'};
  await mkdir(stateDir,{recursive:true,mode:0o700});
  const engine=chromium||(await import('playwright-core')).chromium;
  browser=await engine.launchPersistentContext(join(stateDir,'website-profile'),{executablePath,headless,args:['--disable-gpu'],timeout:30000});
  const abort=()=>{browser?.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
   const websiteCookies={...original.cookies,user_heybox_id:accountId,user_pkey:original.cookies.user_pkey||original.cookies.pkey};
   await browser.addCookies(Object.entries(websiteCookies).map(([name,value])=>({name,value:String(value),domain:'.xiaoheihe.cn',path:'/',secure:true,sameSite:'Lax'})));
   const page=browser.pages()[0]||await browser.newPage();
   await page.goto('https://www.xiaoheihe.cn/',{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForFunction(()=>document.cookie.includes('x_xhh_tokenid='),null,{timeout:30000}).catch(()=>{});
   if(signal?.aborted)return {state:'cancelled'};
   if(new URL(page.url()).hostname!=='www.xiaoheihe.cn')return {state:'refused',code:'website_origin_changed'};
   const received=Object.fromEntries((await browser.cookies('https://www.xiaoheihe.cn/')).map((x)=>[x.name,x.value]));
   if(!received.x_xhh_tokenid)return {state:'verification_required',code:'website_session_unavailable'};
   if([received.heybox_id,received.user_heybox_id].filter(Boolean).some((x)=>String(x)!==accountId))return {state:'refused',code:'account_changed'};
   const candidate={...original,cookies:{...original.cookies,...received}};
   const check=verify||(await import('../../adapters/heybox.mjs')).verifyHeyboxCredentials;
   const identity=await check(candidate,{signal});
   if(identity.state!=='ready'||identity.accountId!==accountId)return {state:'refused',code:'identity_unverified'};
   if(signal?.aborted)return {state:'cancelled'};
   await copyFile(authPath,join(stateDir,'auth.before-website.json'));await chmod(join(stateDir,'auth.before-website.json'),0o600);
   await writeFile(temporary,JSON.stringify(candidate),{mode:0o600});await chmod(temporary,0o600);await rename(temporary,authPath);
   return {state:'success',accountId};
  } finally {signal?.removeEventListener('abort',abort);}
 } catch {return {state:signal?.aborted?'cancelled':'error',code:'website_session_failed'};}
 finally {await browser?.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});}
}
