import { createHash, randomUUID } from 'node:crypto';
import { Engine } from './vendor/engine.mjs';
import { createStore } from './store.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, name, max = 12000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
};
const latest = ticket => ticket.assignments.at(-1);

/** Authority comes only from the host's session resolver, never tool arguments. */
export function createCoordinator({ stateDir, executor, deliverResult, inspectDelivery, maxConcurrency = 2, autoStart = true }) {
  if (!executor?.ensureSession || !executor?.prompt || !executor?.abort || !deliverResult) throw new Error('Coordinator requires executor and result delivery ports');
  maxConcurrency = Math.max(1, Math.min(2, Number(maxConcurrency) || 2));
  const store = createStore(stateDir), { repo, effects } = store;
  const inFlight = new Map();
  let closed = false, pumping, scheduled, timer, clock = 0, recovered = false;
  const origin = ticket => repo.triggers.get(ticket.origin.triggerId).meta.caller;
  const cancelled = ticket => !ticket || store.get('cancelled', ticket.id) || ticket.ended?.by === 'human';
  const live = effect => {
    const ticket = repo.tickets.get(effect.ticketId);
    return ticket && !ticket.ended && !cancelled(ticket) && latest(ticket)?.id === effect.assignmentId;
  };
  function validateCaller(caller) {
    if (!caller || !['operator', 'qq', 'bili', 'worker'].includes(caller.role)) throw new Error('Untrusted caller');
    text(caller.sessionId, 'session', 200); text(caller.chatKey, 'chat scope', 300); text(caller.characterId, 'character', 100);
    if (caller.role === 'worker') {
      const binding = store.get('worker', caller.sessionId);
      if (!binding || binding.chatKey !== caller.chatKey || binding.characterId !== caller.characterId) throw new Error('Unknown worker scope');
    }
    return { sessionId: caller.sessionId, chatKey: caller.chatKey, characterId: caller.characterId, role: caller.role, canWrite: false };
  }
  function visible(caller, ticket) {
    if (caller.role === 'operator') return true;
    if (caller.role === 'worker') return store.get('worker', caller.sessionId)?.ticketId === ticket.id;
    const source = origin(ticket);
    return source.role !== 'operator' && caller.chatKey === source.chatKey && caller.characterId === source.characterId;
  }
  function requireTask(caller, id) {
    caller = validateCaller(caller);
    const ticket = repo.tickets.get(id);
    if (!ticket || !visible(caller, ticket)) throw new Error('Task not found in caller scope');
    return ticket;
  }
  function project(ticket) {
    const assignment = latest(ticket), worker = store.list('worker').find(w => w.assignmentId === assignment?.id);
    const pending = effects.list().filter(e => e.ticketId === ticket.id && !['done', 'dropped'].includes(e.state));
    return { id: ticket.id, state: cancelled(ticket) ? 'stopped' : ticket.ended?.outcome ?? assignment?.report?.state ?? assignment?.state ?? 'pending',
      summary: assignment?.report?.summary ?? '', workerSessionId: worker?.sessionId,
      origin: origin(ticket), createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
      deliveryState: pending.some(e => e.state === 'uncertain') ? 'uncertain' : pending.length ? 'pending' : 'settled' };
  }
  function schedule() {
    if (!autoStart || closed || scheduled) return;
    scheduled = setImmediate(() => { scheduled = undefined; flush().catch(() => {}); });
  }
  function queue(effect) { effects.queue(effect); schedule(); }
  function workerBinding(ticket, assignment) {
    const sessionId = `chopsticks-worker-${hash(assignment.id).slice(0, 32)}`;
    const binding = { ...origin(ticket), sessionId, originSessionId: origin(ticket).sessionId,
      role: 'worker', canWrite: false, ticketId: ticket.id, assignmentId: assignment.id };
    store.put('worker', sessionId, binding);
    return binding;
  }
  const engine = new Engine({
    repo,
    now: () => new Date(clock = Math.max(Date.now(), clock + 1)).toISOString(),
    policy: () => ({ version: 'chopsticks-readonly-v1', paused: false, evalTimeoutMs: 30000,
      gate: trigger => ({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'direct', sender: trigger.actor.id } }),
      revalidate: () => true, admitsInferred: () => false }),
    scope: { scope: () => ({ listened: true, observed: false }) },
    assessor: { request() {} },
    prepareTicket(ticket) {
      // Upstream executors build their first instruction from origin; this adapter
      // persists it as an input so initial and follow-up acceptance share one journal.
      const inputs = ticket.origin.triggerIds.map(triggerId => ({ id: `initial:${hash([ticket.id, triggerId])}`,
        kind: 'trigger', triggerId, human: true, at: ticket.createdAt }));
      return { ...ticket, inputs, undelivered: inputs.map(input => input.id) };
    },
    executor: {
      start(ticket, assignment) {
        const worker = workerBinding(ticket, assignment);
        queue({ id: `launch:${assignment.id}`, kind: 'launch', ticketId: ticket.id, assignmentId: assignment.id, sessionId: worker.sessionId });
      },
      deliver(ticket, assignment) {
        const inputIds = ticket.undelivered.filter(id => !effects.list().some(e => e.kind === 'prompt' && e.assignmentId === assignment.id && e.inputIds.includes(id)));
        if (!inputIds.length) return;
        const worker = workerBinding(ticket, assignment);
        const content = ticket.inputs.filter(i => inputIds.includes(i.id)).map(i => i.kind === 'trigger' ? repo.triggers.get(i.triggerId)?.text : i.text).filter(Boolean).join('\n\n');
        const previous = ticket.assignments.filter(a => a.id !== assignment.id && a.report).at(-1)?.report?.summary;
        const context = previous ? `Original request (context, do not repeat completed work):\n${repo.triggers.get(ticket.origin.triggerId).text}\nPrevious findings:\n${previous}\n\nCurrent request:\n` : '';
        const deliveryId = `prompt:${assignment.id}:${hash(inputIds)}`;
        queue({ id: deliveryId, kind: 'prompt', ticketId: ticket.id, assignmentId: assignment.id,
          sessionId: worker.sessionId, inputIds,
          text: `[Chopsticks task ${ticket.id}] Read-only delegated work. Preserve source identity. Do not send QQ/Bili messages or perform writes. Report structured progress/result using chopsticks_task_report with ticketId=${ticket.id} and deliveryId=${deliveryId}.\n\n${context}${content}` });
      },
      stop(ticket, assignment, reason) {
        // A completed worker may still be inside its report tool call. Do not abort that call.
        if (ticket.ended?.by !== 'human' && !['stopped', 'hostRestarted'].includes(reason)) return;
        const worker = workerBinding(ticket, assignment);
        queue({ id: `abort:${assignment.id}`, kind: 'abort', ticketId: ticket.id, assignmentId: assignment.id, sessionId: worker.sessionId });
      },
    },
    outbox: {
      send(message) { queue({ ...message, id: message.id, kind: 'result', sessionId: message.channel.address.sessionId }); },
      status(id) { const effect = effects.get(id); return !effect ? undefined : effect.state === 'done' ? 'sent' : effect.state === 'dropped' ? 'dropped' : 'pending'; },
      withdraw(id) { if (effects.get(id)?.state !== 'done') effects.set(id, 'dropped'); },
    },
  });

  function trigger(caller, id, prompt, threadId) {
    return { id, source: 'chopsticks', threads: [{ source: 'chopsticks', id: threadId }], actor: { source: 'dsh', id: caller.sessionId },
      human: true, addressed: 'direct', at: new Date().toISOString(), text: prompt, meta: { caller },
      channel: { source: 'dsh', thread: threadId, address: { sessionId: caller.sessionId } } };
  }
  async function submit(caller, args) {
    caller = validateCaller(caller);
    if (caller.role === 'worker') throw new Error('Workers cannot delegate new tasks');
    const requestId = text(args?.requestId, 'request ID', 200), prompt = text(args?.prompt, 'prompt');
    const id = `request:${hash([caller.sessionId, caller.chatKey, caller.characterId, requestId])}`;
    const previous = store.get('request', id);
    if (previous) {
      if (previous.promptHash !== hash(prompt)) throw new Error('Request ID conflict');
      return project(requireTask(caller, previous.ticketId));
    }
    return store.atomic(() => {
      engine.receive(trigger(caller, id, prompt, id));
      const decision = engine.decide(id, { kind: 'accept', title: 'Chopsticks delegated reading task', scope: 'Read-only public research and origin-scoped recall', reason: 'Explicit task tool request' });
      if (!decision.ticketId) throw new Error('Engine did not accept task');
      store.put('request', id, { ticketId: decision.ticketId, promptHash: hash(prompt) });
      return project(repo.tickets.get(decision.ticketId));
    });
  }
  async function follow(caller, id, prompt) {
    const ticket = requireTask(caller, id);
    if (caller.role === 'worker') throw new Error('Workers cannot issue follow-up requests');
    if (cancelled(ticket)) throw new Error('Task stopped');
    prompt = text(prompt, 'follow-up');
    const initial = repo.triggers.get(ticket.origin.triggerId);
    engine.receive(trigger(validateCaller(caller), `follow:${randomUUID()}`, prompt, initial.threads[0].id));
    schedule(); return project(repo.tickets.get(id));
  }
  async function status(caller, id) {
    caller = validateCaller(caller);
    return id ? project(requireTask(caller, id)) : repo.tickets.list().filter(t => visible(caller, t)).slice(0, 100).map(project);
  }
  async function stop(caller, id) {
    const ticket = requireTask(caller, id);
    if (caller.role === 'worker') throw new Error('Worker cannot stop task');
    store.atomic(() => {
      store.put('cancelled', id, { at: new Date().toISOString() });
      if (!ticket.ended) engine.stopTicket(id, 'Stopped by origin or operator');
      for (const effect of effects.list()) if (effect.ticketId === id && effect.kind !== 'abort' && effect.state !== 'done') effects.set(effect.id, 'dropped');
    });
    for (const [effectId, controller] of inFlight) if (effects.get(effectId)?.ticketId === id) controller.abort();
    schedule(); return project(repo.tickets.get(id));
  }
  async function report(caller, { ticketId, state, summary, deliveryId }) {
    caller = validateCaller(caller);
    const ticket = requireTask(caller, ticketId), worker = store.get('worker', caller.sessionId);
    if (caller.role !== 'worker' || worker?.ticketId !== ticketId || worker.assignmentId !== latest(ticket)?.id) throw new Error('Worker is not bound to this assignment');
    if (cancelled(ticket)) throw new Error('Task stopped');
    if (!['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(state)) throw new Error('Invalid report state');
    summary = text(summary, 'summary', 10000);
    if (ticket.ended) {
      if (latest(ticket).report?.state === state && latest(ticket).report?.summary === summary) return project(ticket);
      throw new Error('Task ended');
    }
    const batches = effects.list().filter(e => e.kind === 'prompt' && e.assignmentId === worker.assignmentId && e.state !== 'dropped');
    // A worker report proves the referenced batch was read, including when its
    // prompt acknowledgement is still in flight. Later inbox batches are separate.
    const batch = deliveryId ? batches.find(e => e.id === deliveryId) : batches.length === 1 ? batches[0] : undefined;
    if (!batch || batch.state === 'pending') throw new Error('Report requires an accepted deliveryId from the worker prompt');
    const index = batches.indexOf(batch), previous = store.get('worker-progress', worker.sessionId);
    if (previous && batches.findIndex(e => e.id === previous.deliveryId) > index) throw new Error('Stale worker delivery report');
    const remaining = batches.slice(index + 1);
    const finalState = remaining.length && ['ready', 'dropped'].includes(state) ? 'progress' : state;
    store.atomic(() => {
      for (const read of batches.slice(0, index + 1)) {
        engine.inputsDelivered(ticketId, worker.assignmentId, read.inputIds);
        engine.inputsRead(ticketId, read.inputIds);
        effects.set(read.id, 'done');
      }
      store.put('worker-progress', worker.sessionId, { deliveryId: batch.id });
      engine.report(ticketId, { state: finalState, summary });
      if (finalState === 'ready' || finalState === 'dropped') engine.reply({ purpose: 'result', ticketId, text: `[Chopsticks task ${ticketId}; source ${origin(ticket).chatKey}]\n${summary}` });
    });
    schedule(); return project(repo.tickets.get(ticketId));
  }

  function acknowledge(effect) {
    // A worker may report inside prompt() before the acceptance promise returns.
    // Its report already acknowledged and read that batch; do not make it busy again.
    if (effects.get(effect.id)?.state === 'done') return;
    store.atomic(() => {
      if (effect.kind === 'prompt' && live(effect)) {
        engine.inputsDelivered(effect.ticketId, effect.assignmentId, effect.inputIds);
        // Prompt acceptance alone does not prove that a model read the inputs.
      }
      effects.set(effect.id, 'done');
    });
  }
  async function run(effect) {
    if (effect.kind !== 'abort' && (effect.kind === 'result' ? cancelled(repo.tickets.get(effect.ticketId)) : !live(effect))) {
      effects.set(effect.id, 'dropped'); return;
    }
    if (effect.state === 'uncertain' && !['launch', 'abort'].includes(effect.kind)) {
      const inspect = effect.kind === 'result' ? inspectDelivery : executor.inspect;
      if (!inspect) return;
      let receipt;
      try { receipt = await inspect({ sessionId: effect.sessionId, deliveryId: effect.id, kind: effect.kind }); } catch { return; }
      if (cancelled(repo.tickets.get(effect.ticketId))) { effects.set(effect.id, 'dropped'); return; }
      if (receipt?.status === 'accepted') { acknowledge(effect); return; }
      if (receipt?.status !== 'not-found') return;
    }
    effects.set(effect.id, 'inflight');
    const controller = new AbortController(); inFlight.set(effect.id, controller);
    const isStillAuthorized = () => !closed && !cancelled(repo.tickets.get(effect.ticketId)) && (effect.kind === 'result' || live(effect));
    try {
      if (effect.kind === 'launch') {
        const ticket = repo.tickets.get(effect.ticketId);
        await executor.ensureSession({ sessionId: effect.sessionId, ticket, caller: store.get('worker', effect.sessionId), signal: controller.signal, isStillAuthorized });
        if (!live(effect)) { effects.set(effect.id, 'dropped'); await executor.abort({ sessionId: effect.sessionId }); return; }
        store.atomic(() => { engine.assignmentStarted(effect.ticketId, effect.assignmentId); effects.set(effect.id, 'done'); });
      } else if (effect.kind === 'abort') {
        await executor.abort({ sessionId: effect.sessionId }); effects.set(effect.id, 'done');
      } else {
        // The last synchronous check immediately precedes the external acceptance boundary.
        if (cancelled(repo.tickets.get(effect.ticketId))) { effects.set(effect.id, 'dropped'); return; }
        const send = effect.kind === 'result' ? deliverResult : executor.prompt;
        const receipt = await send({ sessionId: effect.sessionId, text: effect.text, deliveryId: effect.id, signal: controller.signal, isStillAuthorized });
        if (cancelled(repo.tickets.get(effect.ticketId))) { effects.set(effect.id, 'dropped'); return; }
        if (receipt?.accepted === false) {
          // A definite rejection (e.g. foreground busy) is safe to retry; exceptions are not.
          effects.set(effect.id, 'pending', { retryAt: Date.now() + 1000 }); return;
        }
        acknowledge(effect);
      }
    } catch {
      if (cancelled(repo.tickets.get(effect.ticketId)) && effect.kind !== 'abort') effects.set(effect.id, 'dropped');
      else {
        effects.set(effect.id, 'uncertain');
        if (effect.kind === 'prompt' && live(effect)) engine.deliveryFailed(effect.ticketId, effect.assignmentId, 'Delivery acceptance uncertain; receipt inspection required before retry.');
      }
    } finally { inFlight.delete(effect.id); }
  }
  function busy(ticket) {
    if (ticket.ended || latest(ticket)?.state !== 'running') return false;
    const assignment = latest(ticket), report = assignment.report;
    if (effects.list().some(e => e.assignmentId === assignment.id && e.kind === 'prompt' && ['inflight', 'uncertain'].includes(e.state))) return true;
    return !report || report.state === 'progress' || !!assignment.deliveredAt && assignment.deliveredAt >= report.at;
  }
  async function drain() {
    if (!recovered) {
      recovered = true;
      if (executor.isRunning) for (const ticket of repo.tickets.open()) {
        if (!busy(ticket)) continue;
        const assignment = latest(ticket), worker = store.list('worker').find(w => w.assignmentId === assignment.id);
        const pending = effects.list().some(e => e.assignmentId === assignment.id && ['launch', 'prompt'].includes(e.kind) && !['done', 'dropped'].includes(e.state));
        if (!worker || pending) continue;
        try {
          const state = await executor.isRunning({ sessionId: worker.sessionId });
          if (!closed && state?.running === false && state?.pending === false) await workerEnded(worker.sessionId, { restarted: true });
        } catch { /* Unknown host state never authorizes replay or a false completion. */ }
      }
    }
    const attempted = new Set();
    while (!closed) {
      const running = repo.tickets.open().filter(busy).length;
      const effect = effects.list().find(e => !attempted.has(e.id) && ['pending', 'uncertain'].includes(e.state)
        && (!e.retryAt || e.retryAt <= Date.now())
        && (e.kind !== 'launch' || !live(e) || running < maxConcurrency)
        && (e.kind !== 'prompt' || !live(e) || busy(repo.tickets.get(e.ticketId)) || running < maxConcurrency));
      if (!effect) break;
      attempted.add(effect.id); await run(effect);
    }
    if (autoStart && !closed && effects.list().some(e => e.state === 'pending' && e.retryAt)) {
      clearTimeout(timer); timer = setTimeout(schedule, 1000); timer.unref?.();
    }
  }
  function flush() {
    if (closed) return Promise.resolve();
    if (!pumping) pumping = drain().finally(() => { pumping = undefined; });
    return pumping;
  }
  async function close() {
    if (closed) return;
    closed = true; clearImmediate(scheduled); clearTimeout(timer);
    for (const controller of inFlight.values()) controller.abort();
    if (pumping) await pumping;
    store.close();
  }
  async function workerEnded(sessionId, { failed = false, restarted = false } = {}) {
    const worker = store.get('worker', sessionId), ticket = worker && repo.tickets.get(worker.ticketId);
    if (!ticket || cancelled(ticket) || ticket.ended || latest(ticket)?.id !== worker.assignmentId) return;
    const assignment = latest(ticket);
    engine.turnEnded(ticket.id, assignment.id);
    if (!restarted && assignment.report && assignment.report.state !== 'progress' && (!assignment.deliveredAt || assignment.report.at > assignment.deliveredAt)) return;
    store.atomic(() => {
      const question = restarted ? '服务重启，任务等待继续。请查看任务状态后追加要求继续，或停止该任务。'
        : failed ? 'The worker turn failed before a structured result. Inspect task status and follow up or stop it.'
        : 'The worker turn ended without a structured result. Inspect task status and follow up or stop it.';
      engine.report(ticket.id, { state: failed ? 'failed' : 'waiting', summary: question, question });
      engine.reply({ purpose: 'attention', ticketId: ticket.id, question, text: `[Chopsticks task ${ticket.id}] ${question}` });
    });
    schedule(); return project(repo.tickets.get(ticket.id));
  }
  schedule();
  return { submit, follow, status, stop, report, workerEnded, flush, close,
    start(){if(!closed){autoStart=true;schedule();}},
    getWorkerContext(sessionId) {
      const worker = store.get('worker', sessionId), ticket = worker && repo.tickets.get(worker.ticketId);
      return worker && { ...worker, active: !!ticket && !cancelled(ticket) && !ticket.ended && latest(ticket)?.id === worker.assignmentId };
    } };
}
