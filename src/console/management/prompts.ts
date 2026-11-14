// Owner-only, read-only view of the prompt registry. Every piece of prompt
// text shown here is untrusted data: it is only ever assigned as text content.
const $=(id: string)=>(document.getElementById(id) as HTMLInputElement);
const el=(tag: string,text?: any,className?: string)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(className)n.className=className;return n;};
const NODES: Record<string, string>={trigger:'① 触发',gate:'② 门控',router:'③ Router',session:'④ 平台会话',ticket:'④ 协议与票据',act:'⑤ 工具与操作',receipt:'⑥ 回执',turn:'收尾',memory:'记忆',task:'后台任务',background:'回顾与进化'};
const KINDS: Record<string, string>={assembled:'运行时拼装',static:'固定文本',config:'外部文件 / 配置'};
const SEGMENTS: Record<string, string>={static:'固定文本',config:'来自配置',runtime:'当时的数据'};
const ID=/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
let items: any[]=[],selected='',busy=false,token=0,renders: any[]=[],cursor: number|null=null;

const when=(value?: any)=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):'时间未知';};
// Line breaks inside fixed template text are easy to miss; mark them without changing the text's shape.
const marked=(value: string)=>value.replace(/\n/g,'↵\n');
const count=(value?: any)=>Number.isSafeInteger(value)&&value>=0?String(value):'未知';
function status(text: string,error: boolean=false){const node=$('status');node.textContent=text;node.className=error?'error':'';}

async function readBounded(response: Response){
 const maxBytes=2097152,length=response.headers.get('Content-Length');
 if(length!==null&&Number(length)>maxBytes)throw Error('Response too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Missing response');
 let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Response too large');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function rpc(endpoint: string,payload: Record<string, any>){
 const rpcId=crypto.randomUUID?.()||String(Date.now());
 const response=await fetch('/api/chopsticks-console',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({type:'client-request',rpcId,method:'chopsticks-console',payload:{endpoint,payload}})});
 if(!response.ok)throw Error('Unavailable');
 const body=await readBounded(response);
 if(body?.type!=='server-response'||body.rpcId!==rpcId||body.result?.ok!==true||!body.result.value||typeof body.result.value!=='object')throw Error('Invalid response');
 return body.result.value;
}

function kindBadge(kind: string,labels: Record<string, string>=KINDS){return el('span',labels[kind]||kind,'kind '+(labels[kind]?kind:''));}
function linkTo(id: string){const button=el('button',id,'link') as HTMLButtonElement;button.type='button';button.onclick=()=>choose(id);return button;}

function visible(){
 const query=$('query').value.trim().toLowerCase(),kind=$('kind').value,node=$('node').value;
 return items.filter((item)=>(kind==='all'||item.kind===kind)&&(node==='all'||item.node===node)&&(!query||[item.id,item.title,item.source].some((field)=>String(field).toLowerCase().includes(query))));
}
function renderList(){
 const list=$('list'),shown=visible();list.replaceChildren();
 $('count').textContent=`${shown.length} / ${items.length} 条`;
 if(!shown.length){list.append(el('div',items.length?'没有符合筛选条件的提示词。':'尚未读取到提示词。','empty'));return;}
 for(const node of Object.keys(NODES)){
  const rows=shown.filter((item)=>item.node===node);if(!rows.length)continue;
  const group=el('section',undefined,'group'),heading=el('h3');heading.append(el('span',NODES[node]),el('span',`${rows.length} 条`));
  const ul=el('ul');
  for(const item of rows){
   const li=el('li'),button=el('button',undefined,'item') as HTMLButtonElement;button.type='button';
   if(item.id===selected)button.setAttribute('aria-current','true');
   const meta=el('div',undefined,'meta');meta.append(kindBadge(item.kind),el('span',item.id,'mono'));
   if(item.kind==='assembled')meta.append(el('span',item.lastRenderAt?'最近使用 '+when(item.lastRenderAt):'尚无使用记录'));
   button.append(el('strong',item.title),meta);button.onclick=()=>choose(item.id);
   li.append(button);ul.append(li);
  }
  group.append(heading,ul);list.append(group);
 }
}

function facts(rows: [string, any][]){const dl=el('dl',undefined,'facts');for(const [name,value] of rows){if(value===undefined||value===null||value==='')continue;dl.append(el('dt',name),value instanceof Node?(()=>{const dd=el('dd');dd.append(value);return dd;})():el('dd',value));}return dl;}
function labelled(text: string,...extra: Node[]){const label=el('div',undefined,'label');label.append(el('span',text),...extra);return label;}

function renderPart(part: any){
 if(typeof part.text==='string'){const box=el('div',undefined,'part');box.append(labelled('固定文本'),el('div',marked(part.text),'text'));return box;}
 if(typeof part.include==='string'){const box=el('div',undefined,'part');box.append(labelled('引用固定文本',linkTo(part.include)));return box;}
 if(part.options&&typeof part.options==='object'){
  const box=el('div',undefined,'part slot');box.append(labelled('按情况选一段',el('span',part.slot,'mono'),...(part.optional?[el('span','可省略')]:[])));
  for(const [name,text] of Object.entries(part.options)){const option=el('div',undefined,'option');option.append(labelled('选项 '+name),el('div',marked(String(text)),'text'));box.append(option);}
  return box;
 }
 const box=el('div',undefined,'part slot '+(SEGMENTS[part.kind]?part.kind:''));
 box.append(labelled('运行时填入',el('span',part.slot,'mono'),kindBadge(part.kind,SEGMENTS),...(part.optional?[el('span','可省略')]:[]),...(typeof part.ref==='string'?[el('span','由'),linkTo(part.ref),el('span','产生')]:[])));
 for(const [key,name] of [['prefix','有值时在前面附加'],['suffix','有值时在后面附加']])if(typeof part[key]==='string'){const affix=el('div',undefined,'affix');affix.append(labelled(name),el('div',marked(part[key]),'text'));box.append(affix);}
 return box;
}

// Name a segment only when it is not plain template text: a filled slot, a chosen branch or an included prompt.
function segmentTag(slot: string){
 const name=slot.split('/').at(-1)||slot;
 if(name.startsWith('literal:')||name.endsWith(':prefix')||name.endsWith(':suffix'))return '';
 if(name.startsWith('@'))return '引用 '+name.slice(1);
 if(name.includes('='))return name.replace('=',' = ');
 return slot.includes('/')?slot.replace(/\/literal:\d+$/,''):name;
}
// The prompt as it was sent, in one flow. Background colour tells where each piece came from; a small tag
// names the slot. Text that is no longer stored is said to be missing, never filled in.
function renderSegments(render: any){
 const box=el('div',undefined,'sent'),legend=el('div',undefined,'legend'),flow=el('div',undefined,'fulltext');
 legend.append(el('span','无底色：模板固定文本'),kindBadge('config',SEGMENTS),kindBadge('runtime',SEGMENTS));
 for(const segment of Array.isArray(render?.segments)?render.segments.slice(0,64):[]){
  const tag=segmentTag(String(segment.slot)),kind=SEGMENTS[segment.kind]?segment.kind:'static';
  if(tag){const chip=el('span',tag,'tag');chip.title=`${SEGMENTS[kind]} · ${count(segment.chars)} 字符${segment.truncated?' · 保存时已截断':''}`;flow.append(chip);}
  if(typeof segment.text==='string')flow.append(el('span',segment.text,'seg '+(tag?kind:'literal')));
  else flow.append(el('span',segment.omitted?'〔本次响应容量已满，未返回这一段〕':'〔这一段的正文已被清理，无法显示〕','seg gone'));
 }
 box.append(legend,flow);
 return box;
}
function renderRow(id: string,row: any){
 const li=el('li',undefined,'render'),head=el('div',undefined,'render-head'),button=el('button','查看全文') as HTMLButtonElement;button.type='button';
 head.append(el('time',when(row.at)),el('span',count(row.chars)+' 字符'));
 for(const [name,value] of [['事件',row.eventId],['频道',row.channel],['请求',row.requestId]])if(typeof value==='string'&&value)head.append(el('span',`${name} ${value}`,'mono'));
 if(Number.isSafeInteger(row.snapshotId))head.append(el('span','快照 #'+row.snapshotId));
 head.append(button);li.append(head);
 let open: HTMLElement|null=null;
 button.onclick=async()=>{
  if(open){open.remove();open=null;button.textContent='查看全文';return;}
  button.disabled=true;
  try{const value=await rpc('prompt',{id,seq:row.seq});if(!value.render)throw Error('Missing render');open=renderSegments(value.render);li.append(open);button.textContent='收起';}
  catch{status('读取这次发出的全文失败。',true);}
  finally{button.disabled=false;}
 };
 return li;
}

function renderDetail(id: string,value: any){
 const detail=$('detail'),definition=value.definition||{},item=items.find((row)=>row.id===id)||{};detail.replaceChildren();
 const panel=el('section',undefined,'panel');
 panel.append(el('p','提示词详情','eyebrow'),el('h2',item.title||definition.title||id));
 panel.append(facts([['ID',el('code',id)],['节点',NODES[definition.node||item.node]||definition.node||item.node],['类型',KINDS[definition.kind||item.kind]||definition.kind||item.kind],['来源',definition.source||item.source],['字符数',typeof definition.chars==='number'?count(definition.chars):null],['内容哈希',typeof definition.hash==='string'?el('code',definition.hash.slice(0,16)+'…'):null],['模板哈希',typeof definition.templateHash==='string'?el('code',definition.templateHash.slice(0,16)+'…'):null]]));
 if(definition.error)panel.append(el('p','当前读不到这段文本：文件缺失或不可读。','error'));
 else if(typeof definition.text==='string'){panel.append(el('h3','当前文本'),el('pre',definition.text));}
 else if(Array.isArray(definition.parts)){
  panel.append(el('h3','模板结构（按顺序拼接）'));
  const legend=el('div',undefined,'legend');legend.append(kindBadge('static',SEGMENTS),kindBadge('config',SEGMENTS),kindBadge('runtime',SEGMENTS),el('span','虚线框是运行时填入的位置'));
  const template=el('div',undefined,'template');for(const part of definition.parts.slice(0,64))template.append(renderPart(part));
  panel.append(legend,template);
 }
 if(definition.details&&typeof definition.details==='object'){const more=el('details');more.append(el('summary','附加信息'),el('pre',JSON.stringify(definition.details,null,2).slice(0,20000)));panel.append(more);}
 detail.append(panel);
 if(!Array.isArray(definition.parts))return;
 const history=el('section',undefined,'panel');history.append(el('h2','最近发出的记录'));
 const list=el('ul',undefined,'renders'),older=el('button','加载更早的记录','older') as HTMLButtonElement;older.type='button';
 const draw=()=>{list.replaceChildren();for(const row of renders)list.append(renderRow(id,row));older.hidden=cursor===null||renders.length>=200;};
 if(!renders.length)history.append(el('div','保留期内没有这条提示词的发出记录。','empty'));
 else history.append(list,older);
 older.onclick=async()=>{
  if(cursor===null)return;older.disabled=true;const mine=token;
  try{const more=await rpc('prompt',{id,limit:20,beforeSeq:cursor});if(mine!==token)return;const page=Array.isArray(more.renders?.items)?more.renders.items.slice(0,100):[];renders=[...renders,...page];cursor=Number.isSafeInteger(more.renders?.nextBeforeSeq)?more.renders.nextBeforeSeq:null;draw();}
  catch{status('读取更早的记录失败。',true);}
  finally{older.disabled=false;}
 };
 draw();detail.append(history);
}

async function choose(id: string){
 if(!ID.test(id)||id.length>80)return;
 selected=id;const mine=++token;renderList();
 if(location.hash.slice(1)!==id)history.replaceState(null,'','#'+id);
 try{
  const value=await rpc('prompt',{id,limit:20});if(mine!==token)return;
  renders=Array.isArray(value.renders?.items)?value.renders.items.slice(0,100):[];cursor=Number.isSafeInteger(value.renders?.nextBeforeSeq)?value.renders.nextBeforeSeq:null;
  renderDetail(id,value);status('已读取 '+id);
 }catch{if(mine===token)status('读取这条提示词失败，可能已不存在。',true);}
}

async function load(){
 if(busy)return;busy=true;$('refresh').disabled=true;status('正在读取提示词…');
 try{
  const value=await rpc('prompts',{});if(!Array.isArray(value.items)||value.items.length>2000)throw Error('Invalid response');
  items=value.items.filter((item: any)=>item&&typeof item.id==='string'&&ID.test(item.id));
  $('snapshot').textContent=Number.isSafeInteger(value.snapshotId)?'运行快照 #'+value.snapshotId:'运行快照 未记录';
  const nodeSelect=$('node'),current=nodeSelect.value;nodeSelect.replaceChildren(el('option','全部节点'));(nodeSelect.firstChild as HTMLOptionElement).value='all';
  for(const node of Object.keys(NODES))if(items.some((item)=>item.node===node)){const option=el('option',NODES[node]) as HTMLOptionElement;option.value=node;nodeSelect.append(option);}
  nodeSelect.value=[...nodeSelect.querySelectorAll('option')].some((option)=>(option as HTMLOptionElement).value===current)?current:'all';
  const external=$('external');external.replaceChildren();
  for(const row of Array.isArray(value.external)?value.external.slice(0,20):[]){const li=el('li',row?.title);li.append(el('span',row?.reason));external.append(li);}
  renderList();status(`已读取 ${items.length} 条提示词。`);
  const wanted=selected||location.hash.slice(1);if(wanted&&items.some((item)=>item.id===wanted))await choose(wanted);
 }catch{status('读取失败：控制台暂不可用，页面上的内容可能已过期。',true);}
 finally{busy=false;$('refresh').disabled=false;}
}

$('filters').onsubmit=(event)=>event.preventDefault();
for(const id of ['query','kind','node'])$(id).oninput=()=>renderList();
$('refresh').onclick=()=>load();
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id&&id!==selected)void choose(id);});
void load();

export {};
