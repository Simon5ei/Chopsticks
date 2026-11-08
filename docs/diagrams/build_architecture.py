"""Generate the editable, fixed-layout deployed architecture (stdlib only)."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

OUT=Path(__file__).resolve().parent
W,H=1720,3140
C={'ink':'#374151','muted':'#64748b','blue':'#1e40af','line':'#1e3a5f','existing':'#dbeafe','new':'#fed7aa','orange':'#c2410c','ai':'#ddd6fe','purple':'#6d28d9','green':'#a7f3d0','success':'#047857','warn':'#fef3c7','brown':'#b45309','white':'#ffffff','dark':'#1e293b','code':'#22c55e'}
elements=[];svg=[]
def base(id,t,x,y,w,h,color,fill='transparent'):
 return dict(id=id,type=t,x=x,y=y,width=w,height=h,angle=0,strokeColor=color,backgroundColor=fill,fillStyle='solid',strokeWidth=2,strokeStyle='solid',roughness=0,opacity=100,groupIds=[],frameId=None,seed=100000+len(elements)*37,version=1,versionNonce=200000+len(elements)*53,isDeleted=False,boundElements=None,updated=1,link=None,locked=False)
def rect(id,x,y,w,h,fill,stroke,dashed=False):
 e=base(id,'rectangle',x,y,w,h,stroke,fill);e['roundness']={'type':3};e['strokeStyle']='dashed' if dashed else 'solid';elements.append(e)
 svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"'+(' stroke-dasharray="8 7"' if dashed else '')+'/>')
def text(id,x,y,s,size=24,color=None,align='left',width=None):
 color=color or C['ink'];lines=s.split('\n');w=width or max(sum(size*(1 if ord(c)>127 else .61) for c in l) for l in lines);h=len(lines)*size*1.3
 e=base(id,'text',x,y,w,h,color);e.update(text=s,originalText=s,fontSize=size,fontFamily=3,textAlign=align,verticalAlign='top',containerId=None,lineHeight=1.3,autoResize=False);elements.append(e)
 anchor='middle' if align=='center' else 'start';tx=x+w/2 if align=='center' else x
 svg.append(f'<text fill="{color}" font-size="{size}" text-anchor="{anchor}">'+''.join(f'<tspan x="{tx}" y="{y+size+i*size*1.3}">{escape(l)}</tspan>' for i,l in enumerate(lines))+'</text>')
def arrow(id,points,color=None,dashed=False):
 color=color or C['line'];x,y=points[0];p=[[a-x,b-y] for a,b in points];e=base(id,'arrow',x,y,max(a for a,b in p)-min(a for a,b in p),max(b for a,b in p)-min(b for a,b in p),color);e.update(points=p,startBinding=None,endBinding=None,startArrowhead=None,endArrowhead='arrow',elbowed=False);e['strokeStyle']='dashed' if dashed else 'solid';elements.append(e)
 svg.append(f'<polyline points="'+ ' '.join(f'{a},{b}' for a,b in points)+f'" fill="none" stroke="{color}" stroke-width="2.5"'+(' stroke-dasharray="9 7"' if dashed else '')+f' marker-end="url(#{color[1:]})"/>')
def box(id,x,y,w,h,title,body,kind='existing',badge=None):
 stroke=C['purple'] if kind=='ai' else C['orange'] if kind=='new' else C['success'] if kind=='green' else C['line']
 rect(id,x,y,w,h,C[kind],stroke);text(id+'-title',x+22,y+17,title,25,stroke,width=w-44);text(id+'-body',x+22,y+56,body,20,width=w-44)
 if badge:text(id+'-badge',x+w-110,y-30,badge,18,C['orange'])
def save():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'chopsticks-deployed.excalidraw').write_text(json.dumps({'type':'excalidraw','version':2,'source':'https://excalidraw.com','elements':elements,'appState':{'viewBackgroundColor':C['white'],'gridSize':None},'files':{}},ensure_ascii=False,indent=2),encoding='utf8')
 markers=''.join(f'<marker id="{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="{c}" stroke-width="1.5"/></marker>' for c in sorted(set(C.values())))
 (OUT/'chopsticks-deployed.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title"><title id="title">筷子已部署架构：按消息处理顺序</title><defs>{markers}</defs><rect width="100%" height="100%" fill="white"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">'+''.join(svg)+'</g></svg>',encoding='utf8')

# 1. Intake and durable batching.
text('title',80,28,'筷子 · 已部署架构',42,C['blue'])
text('subtitle',80,91,'按消息处理顺序阅读：上 → 下；右侧是辅助能力；外侧虚线是任务结果回流。',23,C['muted'])
text('legend',80,132,'蓝：既有处理　紫：模型参与　橙：本轮增强　绿：确认结果　浅黄：心境　虚线：辅助或回流',19,C['muted'])
box('input',240,195,800,95,'① 消息进入 / 后台生活事件','QQ 私聊 / 群聊；内容平台收件箱、定时浏览机会 → 统一事件')
arrow('input-gate',[(640,290),(640,350)])
box('gate',240,350,800,115,'② 来源校验、程序过滤与事件入库','保留 channel / actorId / eventId；持久化、去重\n筛掉无需唤醒的输入；背景消息仍可保留为经历')
text('stop-note',1060,350,'管理员 /stop 任务ID\n原会话直接停止\n不等窗口、不调用模型',17,C['orange'],width=185)
arrow('gate-state',[(1040,435),(1250,435)],C['line'],True)
arrow('gate-batch',[(640,465),(640,525)])
box('batch',240,525,800,150,'③ 固定 3 秒合批 · 同一 channel','首条开启窗口，后续不延长；不同会话分别计时\n保留每条原始来源；处理中收到的新消息进入下一批','new','本轮新增')
box('state',1250,195,400,255,'持久化状态','events.sqlite：经历 / 批次 / 心境\n平台会话映射 / 发送回执\nsuperagent.sqlite：任务\ntraces.sqlite：追踪 / 用量\nDSH：原生会话 / 队列 / 压缩')
rect('example',1250,525,400,150,C['dark'],C['dark'])
text('example-title',1270,541,'同群连续两条消息',22,C['white'])
text('example-lines',1270,583,'0.0s  event A\n1.2s  event B\n3.0s  batch(A,B) → 一次评估',18,C['code'])

# 2. Existing hierarchy: conditional global attention, then domain decisions.
arrow('batch-scheduler',[(640,675),(640,765)],C['orange'])
rect('scheduler',140,765,1000,390,C['white'],C['purple'])
text('scheduler-heading',165,783,'④ 调度：程序先确定候选领域，再按需调用模型',25,C['purple'])
box('overall',340,840,600,120,'总 Router · 全局注意力分配','仅多领域竞争且无可复用选择时调用\n只有一个可处理领域时，程序直接选中','ai')
arrow('overall-im',[(490,960),(490,985),(400,985),(400,1020)],C['purple'])
arrow('overall-content',[(790,960),(790,985),(880,985),(880,1020)],C['purple'])
box('im',200,1020,400,105,'IM Router','QQ 私聊 / 群聊的批次判断','ai')
box('content',680,1020,400,105,'内容 Router','内容平台私信 / 浏览 / 互动','ai')
text('scheduler-note',165,1132,'领域内有多个平台时按需选平台；选择可短期复用。三个 Router 都是持久 DSH 会话。',17,C['muted'])
arrow('im-decide',[(400,1125),(400,1190),(640,1190),(640,1220)],C['purple'])
arrow('content-decide',[(880,1125),(880,1190),(640,1190),(640,1220)],C['purple'])
rect('decision',140,1220,1000,440,C['white'],C['purple'])
text('decision-heading',165,1237,'⑤ 领域 Router 评估与提交（包含心境更新）',27,C['purple'])
box('prepare',180,1290,920,90,'5.1 准备本批上下文和心境证据','本批消息 + 来源经历 + 任务卡；mood.prepare 读取最多 8 条真实公开证据')
arrow('prepare-assess',[(640,1380),(640,1400)],C['purple'])
box('assess',180,1400,920,95,'5.2 同一次模型评估：调度决定 + 可选心境评价','chopsticks_decide 提交 actions 与 moodUpdates；心境无需另一次模型评估','ai')
arrow('assess-commit',[(640,1495),(640,1515)],C['purple'])
box('commit',180,1515,920,115,'5.3 同一事务：保存调度决定 + 更新心境状态','校验来源与九维评价；数值更新情绪、效价 / 唤醒度、慢变心境\n持久化状态、游标和历史，去重防重放；提交后才派发动作','warn')
arrow('observe',[(1100,1580),(1190,1580),(1190,1680)],C['purple'])
text('observe-label',1010,1686,'observe：只记录，不回复',17,C['muted'],width=230)
box('mood-console',1250,1220,400,440,'心境控制与状态展示','/api/chopsticks/mood\n\npaused：暂停评价与表达\nobserve：更新但不参与表达\nexpress：更新并参与公开表达\n\n当前证据 / 表达范围：\nQQ 群、B站公开\n排除私聊、导入、内部与测试\n\n状态随时间衰减；最近 30 次记录\n刷新页面不触发模型评价','warn')
box('context',1250,840,400,300,'按需上下文 / 任务发现','Router / 会话 / Worker 共用\n近期经历 + 短任务卡\ncontext_search / context_read\nchopsticks_tasks\n\n公开经历 / 研究任务可跨群\n开发结果按原来源读取\n历史资料不增加操作权限','new','本轮新增')
arrow('context-router',[(1250,940),(1140,940)],C['orange'],True)
text('context-read',1150,900,'按需读取',17,C['orange'])
text('state-note',1250,470,'各层按需读写；重启保留状态。',19,C['muted'])

# 3. Execution branches and confirmed-result loop.
arrow('respond-branch',[(640,1630),(640,1680),(395,1680),(395,1760)],C['purple'])
arrow('task-branch',[(640,1630),(640,1680),(925,1680),(925,1760)],C['purple'])
text('respond-label',180,1700,'respond\n聊天 / 平台互动',19,C['blue'],width=200)
text('task-label',710,1700,'task / attach\n耗时任务 / 补充背景',19,C['orange'],width=210)
box('actor',180,1760,430,145,'⑥A 来源会话执行器','QQ 每个联系人 / 群独立并复用\n消费时绑定权限；同会话串行\n读取已提交心境，作为公开表达参考')
box('worker',710,1760,430,145,'⑥B 任务协调器 → Worker','按任务复用 Worker 身份\n研究与开发分工；新开发任务独立目录\n公开研究可接收跨群背景','new')
arrow('develop',[(610,1858),(710,1858)],C['orange'])
text('develop-label',615,1815,'管理员\n开发委派',16,C['orange'],width=95)
arrow('actor-tools',[(395,1905),(395,1980)])
arrow('worker-tools',[(925,1905),(925,1980)],C['orange'])
box('platform-tools',180,1980,430,115,'⑦A 平台 / MCP 工具','平台就绪、来源授权、配额与回执约束\nQQ / B站 / 网页 / 记忆 / 图片工具')
box('worker-tools-box',710,1980,430,115,'⑦B Worker 工具执行','研究：阅读、检索、整理\n开发：chopsticks_exec 执行授权操作')
arrow('platform-receipt',[(395,2095),(395,2170)])
arrow('worker-report',[(925,2095),(925,2170)],C['orange'])
box('receipt',180,2170,430,140,'⑧A 校验发送结果','只有确认回执才记为 message.sent\n结果不确定时保留待核验状态\n纯文本输出不等于已经发到 QQ','green')
box('report',710,2170,430,140,'⑧B 任务报告 / 结果回流','进度写任务状态；ready 生成 task.result\n重新走事件、合批和 Router\n由来源会话回复，Worker 不直接外发','green')
arrow('receipt-journal',[(395,2310),(395,2370)],C['success'])
box('journal',180,2370,430,100,'⑨ 形成可追溯经历','后续消息可读取已确认事实','green')
arrow('report-reentry',[(925,2310),(925,2340),(1170,2340),(1170,2510),(75,2510),(75,408),(240,408)],C['orange'],True)
text('reentry-label',90,2190,'任务结果\n回流入口\n来源保留',16,C['orange'],width=85)
text('receipt-note',700,2380,'attach：补充上下文，不扩大操作授权\nstop：按原来源停止，不自动恢复\n待处理输入与回执均有持久化记录',20,C['muted'])
box('watchdog',1250,1760,400,285,'确定性任务监督','每 30 秒轮转检查一批任务\n默认 5 分钟无进展后检查\n\n可证明空闲的只读任务：恢复一次\n开发 / 失败 / 未确认副作用：待处理\n检查记录、冷却、恢复次数持久化','new','本轮新增')
arrow('supervision-worker',[(1250,1860),(1140,1860)],C['orange'],True)
box('traces',1250,2170,400,300,'全链路追踪 / 管理后台','eventId → batchId → requestId\n→ ticketId → 工具调用 / 回执\n原生响应、实际 token 用量\n未知用量不记为零\n\n/api/chopsticks/pipeline\n另保留：关系图 / 心境 / DSH','new','本轮新增')
arrow('trace-report',[(1140,2235),(1250,2235)],C['success'],True)
text('trace-side',1250,2110,'旁路记录所有阶段，不参与业务决策',18,C['muted'])
text('main-end',80,2540,'⑤完成调度与心境事务提交 → ⑥A读取当前心境表达 → ⑦工具执行 → ⑧确认回执。',21,C['muted'])

# 4. Independent background loops, not mandatory steps for every incoming message.
rect('background-panel',60,2660,1600,385,C['white'],C['line'])
text('background-heading',85,2675,'后台总结与健康观察 · 直接排入内部持久会话，不阻塞消息主链路',28,C['blue'])
text('background-source',85,2720,'真实经历 / 运行快照 → 定时检查 + 新证据条件 → 内部会话 → 持久报告 / 保存回执',21,C['muted'])
box('reflection',85,2780,350,235,'自我反思','按来源范围读取实际经历\n事实与假设分开保存\n每项保留来源 ID\n报告未落库不算完成\n有界恢复，仍失败则待处理')
box('relationships',485,2780,350,235,'人际关系','IM：QQ 私聊与群聊\n内容平台：仅私信\n不处理评论区关系\n报告保存后更新无向图\n后台自动布局、拖动 / 缩放')
box('diary',885,2780,350,235,'私密日志','北京时间 23:30 写作机会\n按来源范围保存 / 明确跳过\n保留事实来源与个人感受\n完整日记限内部日记会话\n写日记不自动发布动态')
box('health-observer',1285,2780,350,235,'运行健康观察','脱敏快照 + 问题变化\n内部 Watchdog 模型分析\n保存诊断与建议\n不自行重启或重放消息\n区别于上方确定性任务监督')
text('footer',80,3080,'部署基线：2026-11-08 · 既有能力补全展示，未新增运行行为；各模块按生产配置启用。',19,C['muted'])
save()
