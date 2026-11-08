const $=(id)=>(document.getElementById(id) as HTMLInputElement);
const modes={paused:'暂停',observe:'观察',express:'表达'},modeKeys=Object.keys(modes);
const maxBytes=262144;
let busy=false,current=null;
const el=(tag?: any,text?: any,className?: any)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
const number=(value)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2):'—';
function exactTime(value?: any){if(value===null||value===undefined||value==='')return '尚未记录';const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():'时间未知';}
function timeNode(value?: any){const node=el('time',exactTime(value));if(node.textContent!=='时间未知'&&node.textContent!=='尚未记录')node.setAttribute('datetime',node.textContent);return node;}
function controls(){
 $('refresh').disabled=busy;
 for(const key of modeKeys){const button: any=$('mode-'+key);button.disabled=busy||!current?.enabled;button.setAttribute('aria-pressed',String(current?.mode===key));}
}
function render(value?: any){
 current=value;
 $('simulation').textContent=value.simulated===true?'模拟心境 · 仅公开经历':'模拟状态标识未知';
 $('mode').textContent=modes[value.mode];
 $('enabled').textContent=value.enabled?'心境已启用。切换后以返回的当前模式为准。':'心境尚未启用，当前无法切换模式。';
 const state=value.state?.initial===true?null:value.state,emotion=state?.emotion;
 $('emotion').textContent=typeof emotion?.label==='string'&&emotion.label?emotion.label:'尚无情绪记录';
 $('intensity').textContent='强度 '+number(emotion?.intensity);
 $('valence').textContent=number(state?.valence);$('arousal').textContent=number(state?.arousal);
 $('mood-valence').textContent=number(state?.mood?.valence);$('mood-arousal').textContent=number(state?.mood?.arousal);
 $('updated').textContent=value.updatedAt===null||value.updatedAt===undefined?'尚未更新':'状态更新于 '+exactTime(value.updatedAt)+' · UTC';
 const history=$('history');history.replaceChildren();
 for(const item of value.history.slice(0,30)){
  if(!item||typeof item!=='object')continue;
  const row=el('li',undefined,'history-item'),heading=el('div',undefined,'record-heading');heading.append(timeNode(item.at),el('strong',item.emotion?.label||'情绪未知'));row.append(heading);
  row.append(el('p','强度 '+number(item.emotion?.intensity)+' · 愉悦度 '+number(item.valence)+' · 活跃度 '+number(item.arousal),'record-values'));
  const details=el('details');details.append(el('summary','公开来源 · 只读'));
  const ids=Array.isArray(item.sourceEventIds)?item.sourceEventIds.slice(0,8):[];
  for(const id of ids){if(typeof id!=='string')continue;const source=Array.isArray(item.sources)?item.sources.find((source)=>source?.id===id):null,entry=el('div',undefined,'source');entry.append(el('code',id));if(source){entry.append(el('span',typeof source.channel==='string'?source.channel:'渠道未知'),timeNode(source.at));}details.append(entry);}
  if(!ids.length)details.append(el('p','来源编号暂无记录','hint'));row.append(details);history.append(row);
 }
 if(!history.children.length)history.append(el('li','暂无公开经历形成的心境记录。','empty'));
 controls();
}
async function readBounded(response?: any){
 const length=response.headers.get('Content-Length');if(length!==null&&Number(length)>maxBytes)throw Error('Response too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Missing response');
 let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Response too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function request(payload: Record<string, any>={}){
 if(busy)return;busy=true;controls();$('status').className='';$('status').textContent=payload.action?'正在切换模式…':'正在读取心境…';
 try{
  const rpcId=crypto.randomUUID?.()||String(Date.now());
  const response=await fetch('/api/chopsticks-console',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({type:'client-request',rpcId,method:'chopsticks-console',payload:{endpoint:'mood',payload}})});
  if(!response.ok)throw Error('Unavailable');const body=await readBounded(response);
  if(body.type!=='server-response'||body.rpcId!==rpcId||body.result?.ok!==true)throw Error('Query failed');
  const value=body.result.value;
  if(!value||typeof value.enabled!=='boolean'||!Object.hasOwn(modes,value.mode)||!Array.isArray(value.history))throw Error('Invalid state');
  render(value);$('status').textContent=payload.action?'当前模式已确认为：'+modes[value.mode]+'。':'已同步。记录时间以 UTC 完整显示。';
 }catch{
  $('status').className='error';$('status').textContent=payload.action?'切换失败，当前模式尚未确认。请刷新查看；已显示的状态会保留。':'读取失败，请从已登录的 DSH 打开此页或稍后刷新。已显示的状态会保留。';
 }finally{busy=false;controls();}
}
for(const key of modeKeys)$('mode-'+key).onclick=()=>request({action:'mode',mode:key});
$('refresh').onclick=()=>request();
request();setInterval(()=>{if(!document.hidden)request();},30000);

export {};
