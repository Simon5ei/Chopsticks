window.__ModuleLoader__.load({
  id: 'chopsticks',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    class Controller {
      constructor(ctx) { this.ctx = ctx; }
      async query(endpoint, filters = {}) {
        const payload = { limit: Math.max(1, Math.min(100, Number(filters.limit) || 50)) };
        for (const key of ['sessionId', 'eventId', 'channel', 'query']) if (String(filters[key] || '').trim()) payload[key] = String(filters[key]).trim();
        if (Number.isSafeInteger(filters.beforeSeq) && filters.beforeSeq > 0) payload.beforeSeq = filters.beforeSeq;
        const response = await this.ctx.connection.rpc.call('/api', 'chopsticks-console', { endpoint, payload });
        const result = response?.result ?? response;
        if (!result?.ok) throw new Error(result?.error?.message || '暂时无法读取筷子运行数据');
        return result.value;
      }
    }
    function mergeItems(current, incoming) {
      return [...new Map([...current, ...incoming].map(item => [item.seq ?? item.id, item])).values()].sort((a,b) => b.seq - a.seq);
    }
    const tabs = [['overview','运行概览'],['events','事件链路'],['traces','思考与工具'],['logs','日志']];
    const labels = {
      reasoning:'模型思考', 'assistant.text':'模型输出', 'tool.call':'工具调用', 'tool.result':'工具结果',
      'turn.start':'回合开始', 'turn.end':'回合结束', 'step.start':'步骤开始', 'step.end':'步骤结束',
      'llm.retry':'模型重试', 'llm.retry-started':'开始重试', 'message.received':'收到消息', 'message.sent':'确认发送',
      'router.archived':'协调运行已归档', 'router.archive_retry':'协调归档待重试', 'router.assess':'路由评估', 'router.evaluate':'路由评估', 'router.decision':'路由决策', 'router.dispatch':'路由执行',
      dispatch:'分派执行', 'task.prompt':'任务请求', 'task.result':'任务结果', timer:'定时触发', error:'错误',
      tool_call:'工具调用', tool_result:'工具结果', turn_start:'回合开始', turn_end:'回合结束', text:'模型输出', retry:'重试', inbound:'收到消息', outbound:'确认发送'
    };
    function countLabel(key) { return ({events:'事件',traces:'追踪',tasks:'任务',pending:'待处理',sessions:'会话',logs:'日志',assessing:'评估中',decided:'已决策',dispatching:'执行中',observed:'已观察',dispatched:'已执行',failed:'失败',uncertain:'结果待确认'})[key] || key; }
    function roleLabel(role) { return ({qq:'QQ 会话',bili:'B站会话',router:'协调器',worker:'任务执行器'})[role] || role || '任务执行器'; }
    function kindLabel(kind) { return labels[kind] || kind || '记录'; }
    function overviewState(data, {busy=false,error=''}={}) {
      const health=data?.health;
      let status='状态未记录';
      if (!data) status=error?'无法读取':busy?'正在读取':'等待数据';
      else if (health?.ready===false) status='已停止';
      else if (health?.ready===true) {
        const qq=health.qq;
        status=qq?.connected===false?'QQ 已断开':qq?.receiveHealthy===false?'QQ 接收异常':
          qq?.connected===true&&qq?.receiveHealthy===true?'运行正常':qq?.connected===true?'接收状态待确认':'QQ 状态待确认';
      }
      const model=typeof data?.model==='string'?data.model:data?.model?.model||data?.model?.modelId||data?.model?.name;
      return {status,model:model||(!data?(error?'无法读取':busy?'正在读取':'等待数据'):'未记录模型'),note:error&&data?'刷新失败，以下为上次读取状态':'来自当前运行实例'};
    }
    const styles = `
      .ck{--bg:#f6f7f9;--panel:#fff;--ink:#202733;--muted:#657080;--line:#e1e5eb;--accent:#276d62;--tint:#eaf4f0;color:var(--ink);background:var(--bg);font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:26px;border-radius:18px;max-width:1200px;margin:auto;min-width:0}
      .ck *{box-sizing:border-box}.ck h2,.ck h3,.ck p{margin:0}.ck h2{font-size:26px;letter-spacing:-.6px}.ck h3{font-size:16px}.ck small,.ck .muted{color:var(--muted)}.ck-head,.ck-row,.ck-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ck-head{justify-content:space-between;margin-bottom:22px}.ck-eyebrow{font-size:11px;letter-spacing:1.8px;color:var(--accent);font-weight:700}.ck-sub{color:var(--muted);margin-top:5px!important}.ck button,.ck input{font:inherit;border:1px solid var(--line);border-radius:9px;color:var(--ink);background:var(--panel);padding:8px 12px;min-height:38px}.ck button{cursor:pointer}.ck button:hover{border-color:var(--accent)}.ck button:disabled{opacity:.5;cursor:default}.ck :focus-visible{outline:2px solid var(--accent);outline-offset:3px}.ck nav{display:flex;gap:5px;border-bottom:1px solid var(--line);margin-bottom:20px;overflow:auto}.ck nav button{white-space:nowrap;background:none;border:none;border-radius:8px 8px 0 0;padding:11px 16px;border-bottom:3px solid transparent}.ck nav button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent);font-weight:700;background:var(--tint)}.ck-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}.ck-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:17px;min-width:0}.ck-value{font-size:23px;font-weight:650;margin:8px 0 2px!important;overflow-wrap:anywhere}.ck-filters{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:10px}.ck-filters input{min-width:0;width:100%}.ck-meta{display:flex;justify-content:space-between;gap:12px;margin:12px 0;color:var(--muted);font-size:12px}.ck-list{display:grid;gap:9px}.ck-entry{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:14px 16px;min-width:0}.ck-entry header{display:flex;justify-content:space-between;gap:12px;align-items:start}.ck-tag{font-size:12px;background:var(--tint);color:var(--accent);padding:2px 8px;border-radius:5px;display:inline-block}.ck-entry time{font-size:12px;color:var(--muted);white-space:nowrap}.ck-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0!important;max-height:160px;overflow:auto}.ck-links{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.ck-links button{font-size:11px;padding:3px 7px;min-height:26px;max-width:100%;overflow-wrap:anywhere;text-align:left}.ck pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 Consolas,monospace;background:var(--bg);padding:12px;border-radius:7px;max-height:420px;overflow:auto;margin:10px 0 0}.ck summary{cursor:pointer;color:var(--accent);font-size:12px;padding-top:8px}.ck-empty{text-align:center;padding:48px 20px;color:var(--muted);border:1px dashed var(--line);border-radius:12px}.ck-error{padding:12px 16px;background:#fcebea;color:#94382f;border:1px solid #efc6c0;border-radius:9px;margin-bottom:12px!important}.ck-footer{display:flex;justify-content:center;margin-top:16px}.ck-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}.ck-dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}.ck-dl{margin:10px 0 0;display:grid;gap:8px}.ck-dl div{display:flex;justify-content:space-between;gap:12px}.ck dt{color:var(--muted)}.ck dd{margin:0;overflow-wrap:anywhere;text-align:right}.ck-wide{grid-column:span 2}.ck-session{padding:9px 0;border-bottom:1px solid var(--line)}.ck-session:last-child{border:0}
      @media(prefers-color-scheme:dark){.ck{--bg:#171d24;--panel:#202832;--ink:#e4eaf2;--muted:#a3afbf;--line:#35414e;--accent:#87cbb8;--tint:#243f39}.ck-error{background:#422c2d;color:#ffb7ad;border-color:#71403d}}:is(.dark,[data-theme=dark]) .ck{--bg:#171d24;--panel:#202832;--ink:#e4eaf2;--muted:#a3afbf;--line:#35414e;--accent:#87cbb8;--tint:#243f39}
      @media(max-width:760px){.ck{padding:16px 12px}.ck-grid{grid-template-columns:1fr}.ck-wide{grid-column:auto}.ck-filters{grid-template-columns:1fr 1fr}.ck-filters input:first-child{grid-column:span 2}.ck-entry header{flex-wrap:wrap}.ck nav button{padding:10px}.ck-head{gap:15px}}`;
    function pretty(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
    function time(value) { if (!value) return '时间未记录'; const d = new Date(value); return Number.isNaN(d.valueOf()) ? String(value) : d.toLocaleString('zh-CN', {hour12:false}); }
    function App({controller}) {
      const [tab,setTab]=React.useState('overview');
      const [filters,setFilters]=React.useState({query:'',sessionId:'',eventId:'',channel:''});
      const [draft,setDraft]=React.useState(filters);
      const [data,setData]=React.useState(null);
      const [busy,setBusy]=React.useState(false);
      const [error,setError]=React.useState('');
      const [paused,setPaused]=React.useState(false);
      const [updated,setUpdated]=React.useState(null);
      const generation=React.useRef(0);
      const request=React.useRef(0);
      async function refresh(older=false, expected=generation.current) {
        if (older) setPaused(true);
        const token=++request.current; setBusy(true); setError('');
        try {
          const value=await controller.query(tab,{...filters,...(older?{beforeSeq:data?.nextBeforeSeq}:{})});
          if (generation.current!==expected || token!==request.current) return;
          setData(previous=>older?{...value,items:mergeItems(previous?.items||[],value.items||[])}:value);setUpdated(new Date());
        } catch(cause) { if(generation.current===expected && token===request.current) setError(cause.message||'连接失败，请稍后重试'); }
        finally {if(generation.current===expected && token===request.current)setBusy(false);}
      }
      React.useEffect(()=>{
        const expected=++generation.current;setData(null);refresh(false,expected);
        return ()=>{generation.current++;};
      },[tab,filters,controller]);
      React.useEffect(()=>{if(paused)return;const timer=setInterval(()=>{if(!busy)refresh();},8000);return()=>clearInterval(timer);},[tab,filters,paused,busy,controller]);
      function correlate(key,value){const next={query:'',sessionId:'',eventId:'',channel:'',[key]:String(value)};setFilters(next);setDraft(next);setTab('traces');}
      function exportPage(){
        const blob=new Blob([(data?.items||[]).map(x=>JSON.stringify(x)).join('\n')+'\n'],{type:'application/x-ndjson;charset=utf-8'});
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='chopsticks-'+tab+'-'+Date.now()+'.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      const card=(label,value,sub)=>h('article',{className:'ck-card'},h('small',null,label),h('p',{className:'ck-value'},value),h('small',null,sub));
      const details=(value)=>h('details',null,h('summary',null,'展开已记录数据'),h('pre',null,pretty(value)));
      const health=data?.health;
      const overview=overviewState(data,{busy,error});
      return h('section',{className:'ck','aria-label':'筷子运行控制台'},h('style',null,styles),
        h('header',{className:'ck-head'},h('div',null,h('p',{className:'ck-eyebrow'},'CHOPSTICKS / 运行追踪'),h('h2',null,'筷子'),h('p',{className:'ck-sub'},'从收到事件，到模型输出与工具执行。')),
          h('div',{className:'ck-actions'},h('a',{href:'/api/chopsticks',target:'_blank',rel:'noopener'},'人际关系 ↗'),h('span',{className:'ck-status'},h('i',{className:'ck-dot'}),paused?'自动刷新已暂停':'每 8 秒刷新'),h('button',{onClick:()=>setPaused(!paused),'aria-pressed':paused},paused?'恢复刷新':'暂停'),h('button',{disabled:busy,onClick:()=>refresh()},busy?'读取中…':'刷新'))),
        h('nav',{role:'tablist','aria-label':'控制台页面'},...tabs.map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':tab===id,onClick:()=>setTab(id)},label))),
        error&&h('p',{className:'ck-error',role:'alert'},error,'。可点击刷新重试；已有数据保留。'),
        tab==='overview' ? h(React.Fragment,null,
          h('div',{className:'ck-grid'},card('运行状态',overview.status,overview.note),card('模型',overview.model,'当前模型配置'),card('执行会话',data?.sessions?.length??'—','独立会话，按来源关联')),
          h('div',{className:'ck-grid'},h('article',{className:'ck-card ck-wide'},h('h3',null,'会话与来源'),...(data?.sessions||[]).map((s,i)=>h('div',{className:'ck-session',key:s.sessionId||i},h('div',{className:'ck-row'},h('span',{className:'ck-tag'},roleLabel(s.role)),h('span',null,s.channel||'未标注来源')),h('div',{className:'ck-links'},h('button',{onClick:()=>correlate('sessionId',s.sessionId)},s.role==='router'?'查看协调运行记录':s.sessionId)))),!data?.sessions?.length&&h('p',{className:'muted'},busy?'正在读取…':'暂无会话记录')),
          h('article',{className:'ck-card'},h('h3',null,'运行计数'),h('dl',{className:'ck-dl'},...Object.entries(data?.counts||{}).map(([k,v])=>h('div',{key:k},h('dt',null,countLabel(k)),h('dd',null,typeof v==='object'?pretty(v):String(v))))),data?.tasks?.length>0&&details(data.tasks))),
          health&&typeof health==='object'&&h('article',{className:'ck-card'},h('h3',null,'实例详情'),details(health))) : h(React.Fragment,null,
          h('form',{className:'ck-filters',onSubmit:e=>{e.preventDefault();setFilters({...draft});}},
            h('input',{'aria-label':'搜索记录',placeholder:'搜索文本、工具名或记录内容',value:draft.query,onChange:e=>setDraft({...draft,query:e.target.value})}),
            h('input',{'aria-label':'按会话筛选',placeholder:'会话 ID',value:draft.sessionId,onChange:e=>setDraft({...draft,sessionId:e.target.value})}),
            h('input',{'aria-label':'按来源事件筛选',placeholder:'来源事件 ID',value:draft.eventId,onChange:e=>setDraft({...draft,eventId:e.target.value})}),h('button',{type:'submit'},'筛选'),
            h('input',{'aria-label':'按频道筛选',placeholder:'频道 / 来源',value:draft.channel,onChange:e=>setDraft({...draft,channel:e.target.value})}),h('button',{type:'button',onClick:()=>{const empty={query:'',sessionId:'',eventId:'',channel:''};setDraft(empty);setFilters(empty);}},'清除筛选')),
          h('div',{className:'ck-meta'},h('span',null,tab==='traces'?'仅显示模型实际输出的思考和工具记录；未输出的内容不展示。':'按记录序号从新到旧排列'),h('button',{disabled:!data?.items?.length,onClick:exportPage},'导出已加载 JSONL')),
          h('div',{className:'ck-list'},...(data?.items||[]).map((item,i)=>h('article',{className:'ck-entry',key:item.seq??item.id??i},
            h('header',null,h('div',{className:'ck-row'},h('span',{className:'ck-tag'},kindLabel(item.kind)),h('strong',null,item.name||item.routeState||item.level||''),h('small',null,'#'+item.seq)),h('time',null,time(item.at))),
            item.text&&h('p',{className:'ck-text'},item.text),
            h('div',{className:'ck-links'},...['eventId','sessionId','channel'].filter(k=>item[k]).map(k=>h('button',{key:k,title:'查看关联追踪',onClick:()=>correlate(k,item[k])},({eventId:'来源',sessionId:'会话',channel:'频道'})[k]+': '+item[k])),item.id&&tab==='events'&&h('button',{onClick:()=>correlate('eventId',item.id)},'追踪此事件 →'),item.callId&&h('small',null,'调用 '+item.callId)),details(item))),
            !data?.items?.length&&h('div',{className:'ck-empty'},h('h3',null,busy?'正在读取运行记录…':'暂无匹配记录'),h('p',null,'可调整筛选条件或稍后刷新。'))),
          h('div',{className:'ck-footer'},h('button',{disabled:busy||!data?.nextBeforeSeq,onClick:()=>refresh(true)},data?.nextBeforeSeq?'加载更早记录':'已到记录末尾'))),
        h('p',{className:'ck-meta','aria-live':'polite'},updated?'上次读取 '+time(updated):'尚未读取',tab!=='overview'&&' · 已加载 '+(data?.items?.length||0)+' 条 · 导出内容以服务端脱敏结果为准'));
    }
    return {inject:['slots','connection'],Controller,mergeItems,overviewState,kindLabel,countLabel,roleLabel,apply(ctx){const controller=new Controller(ctx);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'chopsticks',order:8,label:'筷子'},()=>h(App,{controller})));}};
  }
});


