"""Generate the editable, fixed-layout deployed architecture (stdlib only)."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

OUT=Path(__file__).resolve().parent
W,H=1720,3440
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
box('input',240,195,800,95,'① 消息进入','QQ 私聊 / 群聊；内容平台私信、评论与内容机会')
arrow('input-gate',[(640,290),(640,350)])
box('gate',240,350,800,115,'② 来源校验、程序过滤与事件入库','保留 channel / actorId / eventId；持久化、去重\n筛掉无需唤醒的输入；背景消息仍可保留为经历')
text('stop-note',1060,350,'管理员 /stop 任务ID\n原会话直接停止\n不等窗口、不调用模型',17,C['orange'],width=185)
arrow('gate-state',[(1040,435),(1250,435)],C['line'],True)
arrow('gate-batch',[(640,465),(640,525)])
box('batch',240,525,800,150,'③ 固定 3 秒合批 · 同一 channel','首条开启窗口，后续不延长；不同会话分别计时\n保留每条原始来源；处理中收到的新消息进入下一批','new','本轮新增')
box('state',1250,195,400,255,'持久化状态','events.sqlite：经历 / 批次\n平台会话映射 / 发送回执\nsuperagent.sqlite：任务\ntraces.sqlite：追踪 / 用量\nDSH：原生会话 / 队列 / 压缩')
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
box('decision',300,1220,680,120,'⑤ 领域 Router 提交调度决定','chopsticks_decide：本批最多一个非 observe 动作\n同轮可提交心境评价 → 见下方 M2','ai','本轮增强')
arrow('observe',[(980,1272),(1080,1272)],C['purple'])
text('observe-label',1088,1244,'observe\n只记录，不回复',17,C['muted'],width=155)
box('context',1250,840,400,300,'按需上下文 / 任务发现','Router / 会话 / Worker 共用\n近期经历 + 短任务卡\ncontext_search / context_read\nchopsticks_tasks\n\n公开经历 / 研究任务可跨群\n开发结果按原来源读取\n历史资料不增加操作权限','new','本轮新增')
arrow('context-router',[(1250,940),(1140,940)],C['orange'],True)
text('context-read',1150,900,'按需读取',17,C['orange'])
text('state-note',1250,470,'各层按需读写；重启保留状态。',19,C['muted'])

# 3. Execution branches and confirmed-result loop.
arrow('respond-branch',[(470,1340),(470,1355),(395,1355),(395,1400)],C['purple'])
arrow('task-branch',[(810,1340),(810,1355),(925,1355),(925,1400)],C['purple'])
text('respond-label',200,1368,'respond · 普通聊天 / 平台互动',19,C['blue'])
text('task-label',735,1368,'task / attach · 耗时任务 / 补充背景',19,C['orange'])
box('actor',180,1400,430,145,'⑥A 来源会话执行器','QQ 每个联系人 / 群独立并复用\n消费时绑定权限；同会话串行\n公开表达读取心境 ← 下方 M4')
box('worker',710,1400,430,145,'⑥B 任务协调器 → Worker','按任务复用 Worker 身份\n研究与开发分工；新开发任务独立目录\n公开研究可接收跨群背景','new')
arrow('develop',[(610,1498),(710,1498)],C['orange'])
text('develop-label',615,1455,'管理员\n开发委派',16,C['orange'],width=95)
arrow('actor-tools',[(395,1545),(395,1620)])
arrow('worker-tools',[(925,1545),(925,1620)],C['orange'])
box('platform-tools',180,1620,430,115,'⑦A 平台 / MCP 工具','QQ、B站等读取与受控互动\n网页、记忆、图片等按可用工具调用')
box('worker-tools-box',710,1620,430,115,'⑦B Worker 工具执行','研究：阅读、检索、整理\n开发：chopsticks_exec 执行授权操作')
arrow('platform-receipt',[(395,1735),(395,1810)])
arrow('worker-report',[(925,1735),(925,1810)],C['orange'])
box('receipt',180,1810,430,140,'⑧A 校验发送结果','只有确认回执才记为 message.sent\n结果不确定时保留待核验状态\n纯文本输出不等于已经发到 QQ','green')
box('report',710,1810,430,140,'⑧B 任务报告 / 结果回流','进度写任务状态；ready 生成 task.result\n重新走事件、合批和 Router\n由来源会话回复，Worker 不直接外发','green')
arrow('receipt-journal',[(395,1950),(395,2010)],C['success'])
box('journal',180,2010,430,100,'⑨ 形成可追溯经历','后续消息可读取已确认事实','green')
arrow('report-reentry',[(925,1950),(925,1980),(1170,1980),(1170,2150),(75,2150),(75,408),(240,408)],C['orange'],True)
text('reentry-label',90,1830,'任务结果\n回流入口\n来源保留',16,C['orange'],width=85)
text('receipt-note',700,2020,'attach：补充上下文，不扩大操作授权\nstop：按原来源停止，不自动恢复\n待处理输入与回执均有持久化记录',20,C['muted'])
box('watchdog',1250,1400,400,285,'确定性任务监督','每 30 秒轮转检查一批任务\n默认 5 分钟无进展后检查\n\n可证明空闲的只读任务：恢复一次\n开发 / 失败 / 未确认副作用：待处理\n检查记录、冷却、恢复次数持久化','new','本轮新增')
arrow('supervision-worker',[(1250,1500),(1140,1500)],C['orange'],True)
box('traces',1250,1810,400,300,'全链路追踪 / 管理后台','eventId → batchId → requestId\n→ ticketId → 工具调用 / 回执\n原生响应、实际 token 用量\n未知用量不记为零\n\n/api/chopsticks/pipeline\n另保留：关系图 / 心境 / DSH','new','本轮新增')
arrow('trace-report',[(1140,1875),(1250,1875)],C['success'],True)
text('trace-side',1250,1750,'旁路记录所有阶段，不参与业务决策',18,C['muted'])
text('main-end',80,2180,'上方：消息主链路。下方：与编号步骤连接的心境支路，以及独立触发的后台生活与总结。',20,C['muted'])

# 4. Existing affect branch: named ports keep the main message spine readable.
rect('affect-panel',60,2250,1600,390,C['white'],C['brown'])
text('affect-heading',85,2265,'M · 心境支路（既有设计）｜接在⑤同轮评价，供⑥A公开表达读取',29,C['brown'])
text('affect-subtitle',85,2310,'M2 对应主图⑤；M4 返回主图⑥A。以下箭头是数据流，不是额外四次模型调用。',20,C['muted'])
box('mood-sources',85,2370,350,235,'M1 · 真实公开证据','从② / ⑨事件日志取证\n当前：QQ 群、B站公开\n接收 / 确认发送 / 经历结果\n排除私聊、导入与测试事件\n每轮最多 8 条，有界游标','warn')
box('mood-appraisal',485,2370,350,235,'M2 · Router 同轮评价','⑤评估时附加证据\n可选 9 维 appraisal\n和调度动作一起提交\n无依据可以省略\n不另起一次 LLM 评估','ai')
box('mood-state',885,2370,350,235,'M3 · 程序更新状态','来源校验、去重、事务提交\n情绪类别 / 强度\n效价 / 唤醒度 / 慢变心境\n随时间衰减，回归基线\n状态、游标与历史持久化','warn')
box('mood-expression',1285,2370,350,235,'M4 · 表达参考','⑥A读取短情绪标签与强度\nexpress 模式 + 有有效评价\n仅 QQ 群 / B站公开表达\n不改变回复决策、配额\n不增加工具或操作权限','warn')
for i,x in enumerate([435,835,1235]):arrow('mood-flow-'+str(i),[(x,2480),(x+50,2480)],C['brown'])
box('life',85,2660,750,210,'后台生活 / 平台运行 → ①事件入口','内容浏览机会、收件箱轮询；按配置与平台就绪状态工作\n实际读到 / 做到的内容才形成经历，候选内容不等于经历\n外发受来源授权、平台状态、配额和确认回执共同约束\n不确定发送保留记录；不盲目重发')
box('mood-console',885,2660,750,210,'心境后台 · /api/chopsticks/mood','paused：暂停评价与表达；observe：更新但不用于表达\nexpress：更新并提供公开表达参考\n显示模拟情绪、效价 / 唤醒度、慢变心境与最近 30 次记录\n读取时计算衰减；浏览页面不会新增一轮评价','warn')

# 5. Independent background loops, not mandatory steps for every incoming message.
rect('background-panel',60,2960,1600,385,C['white'],C['line'])
text('background-heading',85,2975,'后台总结与健康观察 · 直接排入内部持久会话，不阻塞消息主链路',28,C['blue'])
text('background-source',85,3020,'真实经历 / 运行快照 → 定时检查 + 新证据条件 → 内部会话 → 持久报告 / 保存回执',21,C['muted'])
box('reflection',85,3080,350,235,'自我反思','按来源范围读取实际经历\n事实与假设分开保存\n每项保留来源 ID\n报告未落库不算完成\n有界恢复，仍失败则待处理')
box('relationships',485,3080,350,235,'人际关系','IM：QQ 私聊与群聊\n内容平台：仅私信\n不处理评论区关系\n报告保存后更新无向图\n后台自动布局、拖动 / 缩放')
box('diary',885,3080,350,235,'私密日志','北京时间 23:30 写作机会\n按来源范围保存 / 明确跳过\n保留事实来源与个人感受\n完整日记限内部日记会话\n写日记不自动发布动态')
box('health-observer',1285,3080,350,235,'运行健康观察','脱敏快照 + 问题变化\n内部 Watchdog 模型分析\n保存诊断与建议\n不自行重启或重放消息\n区别于上方确定性任务监督')
text('footer',80,3380,'部署基线：2026-11-08 · 既有能力补全展示，未新增运行行为；各模块按生产配置启用。',19,C['muted'])
save()
