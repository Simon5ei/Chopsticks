const $=(id)=>(document.getElementById(id) as HTMLInputElement),canvas: any=$('graph'),ctx=canvas.getContext('2d');
const names={fish:'大肥鱼',qq:'QQ',bili:'B站',douyin:'抖音',heybox:'小黑盒'},colors={fish:'#d4a34d',qq:'#599a7d',bili:'#6a9cb5',douyin:'#a690be',heybox:'#be9872'};
let graph: any={nodes:[],edges:[],revision:-1},nodes=[],edges=[],points=new Map(),selected=null,view={x:0,y:0,k:1},width=1,height=1,worker,busy=false,first=true,drag=null,frame;
const time=(value)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const el=(tag?: any,text?: any,className?: any)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
function paint(){if(frame)return;frame=requestAnimationFrame(()=>{frame=null;draw();});}
function draw(){
 const dpr=Math.min(2,devicePixelRatio||1);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.translate(view.x,view.y);ctx.scale(view.k,view.k);
 const query=$('search').value.trim().toLowerCase(),matches=(n)=>!query||(n.label+' '+n.id).toLowerCase().includes(query);
 for(const e of edges){const a=points.get(e.source),b=points.get(e.target);if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=(e.source===selected||e.target===selected?2:1)/view.k;ctx.strokeStyle=e.source===selected||e.target===selected?'#578f75':'#b8cdbf';ctx.setLineDash(e.certainty==='hypothesis'?[5/view.k,5/view.k]:[]);ctx.stroke();}
 ctx.setLineDash([]);
 for(const n of nodes){const p=points.get(n.id);if(!p)continue;const r=n.id==='fish'?14:9;ctx.globalAlpha=matches(n)?1:.22;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=colors[n.platform]||'#8a9b90';ctx.fill();if(n.id===selected){ctx.strokeStyle='#244c3a';ctx.lineWidth=2/view.k;ctx.beginPath();ctx.arc(p.x,p.y,r+5/view.k,0,Math.PI*2);ctx.stroke();}if(view.k>.5||n.id===selected||n.id==='fish'||query&&matches(n)){ctx.font=`${12/view.k}px "Microsoft YaHei",sans-serif`;ctx.fillStyle='#3a5c48';ctx.textAlign='center';ctx.fillText(n.label.slice(0,16),p.x,p.y+r+16/view.k);}}
 ctx.globalAlpha=1;
}
function fit(){if(!points.size)return;const pts=nodes.map((n)=>points.get(n.id)).filter(Boolean);if(!pts.length)return;const xs=pts.map((p)=>p.x),ys=pts.map((p)=>p.y),l=Math.min(...xs),r=Math.max(...xs),t=Math.min(...ys),b=Math.max(...ys);view.k=Math.max(.08,Math.min(2.2,(width-110)/Math.max(100,r-l),(height-110)/Math.max(100,b-t)));view.x=width/2-(l+r)/2*view.k;view.y=height/2-(t+b)/2*view.k;paint();}
function arrange(reset: boolean=false,autofit: boolean=false){
 worker?.terminate();if(reset)points.clear();
 nodes.forEach((n?: any,i?: any)=>{if(!points.has(n.id))points.set(n.id,{x:Math.cos(i*2.39996)*Math.sqrt(i+1)*32,y:Math.sin(i*2.39996)*Math.sqrt(i+1)*32});});
 worker=new Worker('/api/chopsticks/layout.js');worker.onmessage=({data}: { data?: any; [key: string]: any })=>{for(const p of data.points)if(!points.get(p.id)?.pinned)points.set(p.id,p);if(autofit)fit();paint();if(data.done)worker.terminate();};worker.onerror=()=>{if(autofit)fit();};
 worker.postMessage({nodes:nodes.map((n)=>({...n,...points.get(n.id)})),edges});if(autofit)fit();paint();
}
function select(id?: any){selected=id;details();people();paint();}
function details(){
 const box=$('detail');box.replaceChildren();const n=nodes.find((n)=>n.id===selected);
 if(!n){box.append(el('p','人物档案','eyebrow'),el('h2','选择一位人物'),el('p','点击节点或下方名字，查看关系、更新时间和来源记录。'));return;}
 box.append(el('p',names[n.platform]||n.platform,'eyebrow'),el('h2',n.label),el('span',n.id,'badge'),el('p','最近总结：'+time(n.lastAt)));
 const relations=edges.filter((e)=>e.source===n.id||e.target===n.id);
 if(!relations.length)box.append(el('p','已有对话来源，暂未总结出人物间的关系。'));
 for(const edge of relations){const other=nodes.find((v)=>v.id===(edge.source===n.id?edge.target:edge.source)),card=el('section',undefined,'relation');card.append(el('h3','与 '+(other?.label||'未知人物')));
  for(const o of edge.observations.filter((o)=>$('hypotheses').checked||o.certainty==='observed')){card.append(el('p',(o.certainty==='hypothesis'?'推测 · ':'观察 · ')+o.relation));const d=el('details');d.append(el('summary','来源 · '+time(o.at)));for(const e of o.evidence)d.append(el('p',`${e.channel} · ${time(e.at)}\n${e.id}`));card.append(d);}box.append(card);
 }
}
function people(){const query=$('search').value.trim().toLowerCase(),items=nodes.filter((n)=>(n.label+' '+n.id).toLowerCase().includes(query)).sort((a?: any,b?: any)=>a.id==='fish'?-1:b.id==='fish'?1:a.label.localeCompare(b.label,'zh-CN'));$('list-count').textContent=String(items.length);$('people').replaceChildren();for(const n of items.slice(0,200)){const b=el('button',undefined,n.id===selected?'selected':'');b.append(el('span',n.label),el('small',names[n.platform]||n.platform));b.onclick=()=>{select(n.id);const p=points.get(n.id);if(p){view.k=Math.max(view.k,1);view.x=width/2-p.x*view.k;view.y=height/2-p.y*view.k;paint();}};$('people').append(b);}if(items.length>200)$('people').append(el('p','显示前 200 位，请搜索缩小范围。'));}
function filter(autofit: boolean=true){const p=$('platform').value;nodes=graph.nodes.filter((n)=>p==='all'||n.platform===p||n.id==='fish');const ids=new Set<any>(nodes.map((n)=>n.id));edges=graph.edges.filter((e)=>ids.has(e.source)&&ids.has(e.target)&&($('hypotheses').checked||e.certainty==='observed'));if(p!=='all'&&nodes.length===1&&nodes[0].id==='fish')nodes=[];$('node-count').textContent=String(nodes.length);$('edge-count').textContent=String(edges.length);$('empty').hidden=nodes.length>0;details();people();arrange(false,autofit);}
async function refresh(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{const response=await fetch('/api/chopsticks-console',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID?.()||String(Date.now()),method:'chopsticks-console',payload:{endpoint:'relationships',payload:{}}})});if(!response.ok)throw Error('需要登录或服务暂不可用');const body=await response.json();if(!body.result?.ok)throw Error('关系图暂不可用');const value=body.result.value;if(!Array.isArray(value.nodes)||!Array.isArray(value.edges))throw Error('关系图数据无效');if(value.version!==graph.version||value.revision!==graph.revision){graph=value;filter(first);first=false;}$('status').className='';$('status').textContent=value.disabled?'人际关系总结尚未启用。':value.truncated?'图已达到当前容量上限，部分人物或关系未展示。':'实线是已观察到的关系，虚线是待确认的推测。评论区不参与整理。';$('updated').textContent=value.updatedAt?'总结更新于 '+time(value.updatedAt):'尚未生成总结';}
 catch(error){$('status').className='error';$('status').textContent='读取失败，请从已登录的 DSH 打开此页或稍后刷新。已显示的图会保留。';}
 finally{busy=false;$('refresh').disabled=false;}
}
function zoom(factor?: any,x: any=width/2,y: any=height/2){const k=Math.max(.06,Math.min(5,view.k*factor)),ratio=k/view.k;view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.k=k;paint();}
const position=(e)=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
canvas.onpointerdown=(e)=>{const p=position(e),x=(p.x-view.x)/view.k,y=(p.y-view.y)/view.k;let hit;for(const n of [...nodes].reverse()){const v=points.get(n.id);if(v&&Math.hypot(v.x-x,v.y-y)<Math.max(12,15/view.k)){hit=n.id;break;}}drag={id:hit,start:p,last:p,moved:false};canvas.setPointerCapture(e.pointerId);if(hit)select(hit);};
canvas.onpointermove=(e)=>{if(!drag)return;const p=position(e),dx=p.x-drag.last.x,dy=p.y-drag.last.y;drag.moved||=Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>3;if(drag.id){const v=points.get(drag.id);v.x+=dx/view.k;v.y+=dy/view.k;v.pinned=true;}else{view.x+=dx;view.y+=dy;}drag.last=p;paint();};
canvas.onpointerup=(e)=>{if(drag&&!drag.id&&!drag.moved)select(null);drag=null;canvas.releasePointerCapture(e.pointerId);};canvas.onpointercancel=()=>{drag=null;};
canvas.addEventListener('wheel',(e)=>{e.preventDefault();const p=position(e);zoom(Math.exp(-e.deltaY*.001),p.x,p.y);},{passive:false});
canvas.onkeydown=(e)=>{if(e.key==='+'||e.key==='=')zoom(1.2);else if(e.key==='-')zoom(1/1.2);else if(e.key==='0')fit();else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();view.x+=e.key==='ArrowLeft'?30:e.key==='ArrowRight'?-30:0;view.y+=e.key==='ArrowUp'?30:e.key==='ArrowDown'?-30:0;paint();}};
new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();width=r.width;height=r.height;const d=Math.min(2,devicePixelRatio||1);canvas.width=width*d;canvas.height=height*d;if(first){view.x=width/2;view.y=height/2;}paint();}).observe(canvas);
$('search').oninput=()=>{people();paint();};$('platform').onchange=()=>filter();$('hypotheses').onchange=()=>filter(false);$('fit').onclick=fit;$('layout').onclick=()=>arrange(true,true);$('refresh').onclick=refresh;$('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);
refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);

export {};
