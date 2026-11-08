// Bounded force layout off the UI thread; spatial buckets avoid all-pairs repulsion.
self.onmessage=({data}: { data?: any; [key: string]: any })=>{
 const {nodes,edges}=data,n=nodes.length,index=new Map(nodes.map((v?: any,i?: any)=>[v.id,i]));
 const pts=nodes.map((v?: any,i?: any)=>({id:v.id,x:v.x??Math.cos(i*2.39996)*Math.sqrt(i+1)*32,y:v.y??Math.sin(i*2.39996)*Math.sqrt(i+1)*32,pinned:v.pinned}));
 const links=edges.map((e)=>[index.get(e.source),index.get(e.target)]).filter((e)=>e.every((i)=>i!==undefined));
 for(let step=0;step<140;step++){
  const cells=new Map(),fx=new Float64Array(n),fy=new Float64Array(n),cell=100;
  for(let i=0;i<n;i++){const p=pts[i],key=Math.floor(p.x/cell)+','+Math.floor(p.y/cell);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);}
  for(let i=0;i<n;i++){
   const p=pts[i],cx=Math.floor(p.x/cell),cy=Math.floor(p.y/cell);let checks=0;
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of cells.get((cx+dx)+','+(cy+dy))||[]){
    if(i===j||++checks>160)continue;const q=pts[j],x=p.x-q.x||.01,y=p.y-q.y||.01,d2=x*x+y*y+20;
    fx[i]+=x*650/d2;fy[i]+=y*650/d2;
   }
   fx[i]-=p.x*.006;fy[i]-=p.y*.006;
  }
  for(const [a,b] of links){const x=pts[b].x-pts[a].x,y=pts[b].y-pts[a].y,d=Math.hypot(x,y)||1,k=(d-110)*.018/d;fx[a]+=x*k;fy[a]+=y*k;fx[b]-=x*k;fy[b]-=y*k;}
  const cooling=1-step/180;
  for(let i=0;i<n;i++)if(!pts[i].pinned){pts[i].x+=Math.max(-12,Math.min(12,fx[i]))*cooling;pts[i].y+=Math.max(-12,Math.min(12,fy[i]))*cooling;}
  if(step%35===34)self.postMessage({points:pts,done:step===139});
 }
 if(!n)self.postMessage({points:[],done:true});
};

export {};
