// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { key } from './ids.mjs';
import { UserError } from './errors.mjs';
import { latestAssignment, latestReport, liveTicket, readUntil, runningAssignment, settled, threadKey, waitsForPerson } from './model.mjs';
import { EnginePart } from './part.mjs';
import { canRetry } from './stage.mjs';
const sameChannel = (a, b)=>JSON.stringify(a) === JSON.stringify(b);
export const automatic = (input)=>input?.kind === 'note' || input?.kind === 'trigger' && !input.human;
const readBefore = (input, until)=>input.readAt === undefined ? (input.deliveredAt && input.deliveredAt > input.at ? input.deliveredAt : input.at) <= until : !!input.readAt && input.readAt < until;
const STATUS_REQUEST = '仅报告当前任务状态，调用 chopsticks_task_report，使用本轮 ticketId 和 deliveryId。';
export class Tickets extends EnginePart {
    replies;
    constructor(options, replies){
        super(options), this.replies = replies;
    }
    create(id, decisionId, mandate, evaluation, outcome, at) {
        const { triggerIds } = evaluation;
        const primary = this.repo.triggers.get(evaluation.primary ?? triggerIds.at(-1));
        const origin = {
            triggerId: primary?.id ?? triggerIds[0],
            triggerIds
        };
        let ticket = {
            id,
            title: outcome.title,
            decisionId,
            mandate,
            channels: [],
            assignments: [],
            inputs: [],
            undelivered: [],
            createdAt: at,
            updatedAt: at,
            origin
        };
        for (const triggerId of triggerIds){
            const channel = this.repo.triggers.get(triggerId)?.channel;
            if (channel && !ticket.channels.some((item)=>sameChannel(item, channel))) ticket.channels.push(channel);
        }
        ticket = this.options.prepareTicket?.(ticket, outcome) ?? ticket;
        const assignment = this.newAssignment(ticket);
        this.repo.tickets.save(ticket);
        for (const triggerId of triggerIds)for (const ref of this.repo.triggers.get(triggerId)?.threads ?? [])this.subscribe(id, ref);
        if (outcome.acknowledgement && primary) this.replies.acknowledgeAccepted(id, primary, outcome.acknowledgement);
        this.options.executor.start(this.require(id), assignment);
        this.emit('ticket.created', {
            ticketId: id,
            decisionId,
            strength: mandate.strength
        });
    }
    bind(ticketId, thread, own) {
        if (!liveTicket(this.require(ticketId))) throw new UserError('ticketEnded');
        this.subscribe(ticketId, thread);
        const ticket = this.require(ticketId);
        const followed = threadKey(thread);
        const follow = ticket.follows?.find((item)=>item.thread === followed);
        if (follow) {
            follow.own ||= own;
            delete follow.closed;
        } else ticket.follows = [
            ...ticket.follows ?? [],
            {
                thread: followed,
                own
            }
        ];
        ticket.updatedAt = this.now();
        this.repo.tickets.save(ticket);
        return ticket;
    }
    threadClosed(thread, outcome, at) {
        const closed = threadKey(thread);
        for (const ticket of this.repo.tickets.open()){
            const follow = ticket.follows?.find((item)=>item.thread === closed && !item.closed);
            if (!follow) continue;
            follow.closed = {
                at,
                outcome
            };
            this.repo.tickets.save(ticket);
            const done = this.followsDone(ticket);
            if (!done || this.unfinished(ticket, at)) continue;
            const resumed = Date.parse(latestAssignment(ticket)?.createdAt ?? '') > Date.parse(at);
            this.end(ticket.id, 'executor', done.outcome, resumed ? this.now() : done.at);
        }
    }
    followsDone(ticket) {
        const follows = ticket.follows ?? [];
        const own = follows.filter((item)=>item.own);
        const counted = own.length ? own : follows;
        if (!counted.length || counted.some((item)=>!item.closed)) return undefined;
        return counted.map((item)=>item.closed).sort((a, b)=>a.at.localeCompare(b.at)).at(-1);
    }
    attachable(ticketId, triggerId) {
        const trigger = this.repo.triggers.get(triggerId);
        if (!trigger) throw new UserError('unknownTrigger');
        this.leftToWorkers(trigger);
        const current = this.require(ticketId);
        if (current.ended?.by === 'human') throw new UserError('ticketStopped');
        if (!liveTicket(current) && !this.policy().revalidate(current.mandate)) throw new UserError('mandateRevoked');
        return trigger;
    }
    attach(ticketId, trigger, note) {
        for (const ref of trigger.threads)this.subscribe(ticketId, ref);
        const current = this.repo.triggers.disposition(trigger.id) ?? {
            fanout: [],
            at: this.now()
        };
        const { context, requeued, ...disposition } = current;
        const followed = context?.filter((id)=>id !== ticketId);
        this.repo.triggers.saveDisposition(trigger.id, {
            ...disposition,
            fanout: [
                ...new Set([
                    ...disposition.fanout,
                    ticketId
                ])
            ],
            ...followed?.length ? {
                context: followed
            } : {}
        });
        const ticket = this.require(ticketId);
        const id = key('input', ticketId, 'trigger', trigger.id);
        const existing = ticket.inputs.find((input)=>input.id === id);
        const at = this.now();
        const input = (inputId)=>({
                id: inputId,
                kind: 'trigger',
                triggerId: trigger.id,
                at,
                ...note ? {
                    note
                } : {},
                ...trigger.human ? {
                    human: true
                } : {}
            });
        if (existing?.kind !== 'trigger') this.addInput(ticket, input(id));
        else if (note && ticket.undelivered.includes(id)) {
            existing.note = note;
            ticket.updatedAt = at;
            this.repo.tickets.save(ticket);
        } else if (requeued || !current.fanout.includes(ticketId) || context?.includes(ticketId) || !liveTicket(ticket)) {
            this.addInput(ticket, input(key('input', ticketId, 'trigger', trigger.id, 'attached', at)));
        } else if (note) this.addInput(ticket, input(key('input', ticketId, 'trigger', trigger.id, 'note', note)));
    }
    requestStatus(ticketId) {
        const ticket = this.require(ticketId);
        if (!liveTicket(ticket) || runningAssignment(ticket)?.report?.state !== 'waiting') return false;
        this.addInput(ticket, {
            id: `status:${ticketId}:${ticket.updatedAt}`,
            kind: 'text',
            text: STATUS_REQUEST,
            at: this.now()
        });
        return true;
    }
    stop(ticketId, reason) {
        this.end(ticketId, 'human', 'stopped', this.now(), reason);
        return this.require(ticketId);
    }
    retry(ticketId) {
        const ticket = this.require(ticketId);
        const latest = latestAssignment(ticket);
        if (!canRetry(ticket) || !latest) throw new UserError('notRetryable');
        this.endAssignment(ticket, latest, 'retried');
        this.requeueUntaken(ticket, latest);
        const assignment = this.newAssignment(ticket);
        ticket.updatedAt = this.now();
        this.repo.tickets.save(ticket);
        this.options.executor.stop(ticket, latest, 'retried');
        this.options.executor.start(ticket, assignment);
        return ticket;
    }
    markUnrelated(ticketId, thread, reason) {
        const ticket = this.require(ticketId);
        if (this.source(ticket)?.threads.some((ref)=>threadKey(ref) === thread)) throw new UserError('sourceThread');
        if (ticket.follows?.some((item)=>item.thread === thread)) throw new UserError('followedThread');
        if (!this.repo.threads.get(thread)?.subscriptions.includes(ticketId)) throw new UserError('notFollowing');
        this.dropSubscriptions(thread, 'executor', ticketId, reason);
        for (const trigger of this.triggersOf(ticket)){
            if (trigger.threads.some((ref)=>threadKey(ref) === thread) && this.owners(trigger).includes(ticketId)) this.handBack(ticketId, trigger, reason);
        }
    }
    policyChanged(from, to, effects) {
        const at = this.now();
        for (const ticket of this.repo.tickets.open().sort((a, b)=>a.createdAt.localeCompare(b.createdAt))){
            const effect = effects.get(ticket.id);
            if (effect) this.addInput(ticket, {
                id: key('input', ticket.id, 'policy', from, to, at),
                kind: 'policy-changed',
                from,
                to,
                at,
                effect
            });
        }
    }
    dropSubscriptions(thread, by, ticketId, reason) {
        const current = this.repo.threads.get(thread);
        const tickets = current?.subscriptions.filter((id)=>ticketId === undefined || id === ticketId) ?? [];
        if (!current || !tickets.length) return false;
        current.subscriptions = current.subscriptions.filter((id)=>!tickets.includes(id));
        this.repo.threads.save(current);
        for (const id of tickets){
            const ticket = this.repo.tickets.get(id);
            if (!ticket?.follows?.some((item)=>item.thread === thread)) continue;
            const { follows: before, ...rest } = ticket;
            const follows = before.filter((item)=>item.thread !== thread);
            this.repo.tickets.save(follows.length ? {
                ...rest,
                follows
            } : rest);
        }
        for (const id of tickets)this.emit('thread.unsubscribed', {
            threadKey: current.key,
            ticketId: id,
            by,
            ...reason ? {
                reason
            } : {}
        });
        return true;
    }
    addInput(ticket, input) {
        if (ticket.inputs.some((existing)=>existing.id === input.id)) return;
        ticket.inputs.push(input);
        ticket.updatedAt = this.now();
        const held = liveTicket(ticket) && automatic(input) && waitsForPerson(ticket);
        if (!held) ticket.undelivered.push(input.id);
        this.repo.tickets.save(ticket);
        if (!liveTicket(ticket) || held) return;
        const running = runningAssignment(ticket), latest = latestAssignment(ticket);
        if (running) this.options.executor.deliver(ticket, running);
        else if (latest?.state === 'pending' && !waitsForPerson(ticket)) this.options.executor.start(ticket, latest);
    }
    wake(ticketId) {
        const ticket = this.repo.tickets.get(ticketId);
        if (!ticket || liveTicket(ticket) || ticket.ended?.by === 'human' || !ticket.undelivered.length) return;
        const policy = this.policy();
        if (policy.paused) return;
        if (!policy.revalidate(ticket.mandate)) {
            this.refuse(ticket);
            return;
        }
        const first = ticket.undelivered.map((id)=>ticket.inputs.find((input)=>input.id === id)).find((input)=>input?.kind === 'trigger' && input.human);
        if (first?.kind !== 'trigger') return;
        const at = this.now();
        delete ticket.ended;
        ticket.updatedAt = at;
        const assignment = this.newAssignment(ticket);
        const resumed = {
            id: key('input', ticket.id, 'resumed', first.triggerId),
            kind: 'resumed',
            triggerId: first.triggerId,
            at
        };
        ticket.inputs.push(resumed);
        ticket.undelivered.unshift(resumed.id);
        this.repo.tickets.save(ticket);
        this.options.executor.start(ticket, assignment);
        this.emit('ticket.resumed', {
            ticketId,
            triggerId: first.triggerId
        });
    }
    triggersOf(ticket, ids) {
        return ticket.inputs.flatMap((input)=>input.kind === 'trigger' && (!ids || ids.includes(input.id)) ? this.repo.triggers.get(input.triggerId) ?? [] : []);
    }
    takenUp(ticket, trigger) {
        const acked = this.repo.triggers.disposition(trigger.id)?.acked;
        return acked ? acked.includes(ticket.id) : this.options.outbox.status(key('ack', trigger.id)) !== undefined;
    }
    untaken(ticket, ids) {
        return this.triggersOf(ticket, ids).filter((trigger)=>this.owners(trigger).includes(ticket.id) && !this.takenUp(ticket, trigger));
    }
    letGo(ticketId, waiting, left) {
        for (const trigger of [
            ...waiting,
            ...left
        ]){
            const disposition = this.repo.triggers.disposition(trigger.id);
            if (disposition?.fanout.includes(ticketId)) {
                this.repo.triggers.saveDisposition(trigger.id, {
                    ...disposition,
                    fanout: disposition.fanout.filter((id)=>id !== ticketId)
                });
            }
        }
        for (const trigger of left){
            const disposition = this.repo.triggers.disposition(trigger.id);
            const decision = disposition?.decisionId ? this.repo.decisions.get(disposition.decisionId) : undefined;
            const stopped = decision?.kind === 'stop' && decision.ticketId === ticketId && !disposition?.handbacks?.length;
            const decided = !!decision && (settled(decision) || stopped);
            if (!this.owners(trigger).length && !disposition?.acked?.length && !decided) this.queueForEval(trigger);
        }
    }
    refuse(ticket) {
        const waiting = this.triggersOf(ticket, ticket.undelivered), left = this.untaken(ticket, ticket.undelivered);
        ticket.undelivered = [];
        this.repo.tickets.save(ticket);
        this.letGo(ticket.id, waiting, left);
    }
    restart(ticket, running, reason, note) {
        this.endAssignment(ticket, running, reason);
        this.requeueUntaken(ticket, running);
        const assignment = this.newAssignment(ticket);
        const at = this.now();
        const input = {
            id: key('input', ticket.id, 'restart', assignment.id),
            kind: 'text',
            text: note,
            at
        };
        ticket.inputs.push(input);
        ticket.undelivered.push(input.id);
        ticket.updatedAt = at;
        this.repo.tickets.save(ticket);
        this.options.executor.start(ticket, assignment);
    }
    requeueUntaken(ticket, replaced) {
        const untaken = ticket.inputs.filter((input)=>input.kind === 'trigger' && input.readAt === null && input.deliveredTo === replaced.id && !ticket.undelivered.includes(input.id));
        ticket.undelivered.unshift(...untaken.map((input)=>input.id));
    }
    end(ticketId, by, outcome, at = this.now(), reason) {
        const ticket = this.require(ticketId);
        if (!liveTicket(ticket)) return;
        const stopping = ticket.assignments.filter((assignment)=>assignment.state !== 'ended');
        const why = reason && reason !== outcome ? {
            reason
        } : {};
        const until = readUntil(ticket);
        const waiting = this.triggersOf(ticket, ticket.undelivered);
        const left = this.untaken(ticket, ticket.inputs.flatMap((input)=>input.kind === 'trigger' && (!readBefore(input, until) || ticket.undelivered.includes(input.id)) ? [
                input.id
            ] : []));
        ticket.ended = {
            at,
            by,
            outcome,
            ...why
        };
        ticket.undelivered = [];
        ticket.updatedAt = this.now();
        delete ticket.attention;
        delete ticket.delivery;
        for (const assignment of stopping){
            assignment.state = 'ended';
            assignment.endedAt = at;
        }
        this.repo.tickets.save(ticket);
        this.letGo(ticketId, waiting, left);
        this.emit('ticket.ended', {
            ticketId,
            by,
            outcome,
            ...why
        });
        for (const assignment of stopping)this.options.executor.stop(ticket, assignment, reason ?? outcome);
    }
    unfinished(ticket, at) {
        const until = readUntil(ticket, false);
        const taken = this.triggersOf(ticket, ticket.inputs.flatMap((input)=>input.kind === 'trigger' && !readBefore(input, until) ? [
                input.id
            ] : [])).some((trigger)=>this.owners(trigger).includes(ticket.id) && this.takenUp(ticket, trigger));
        const latest = latestAssignment(ticket);
        if (taken || !(Date.parse(latest?.createdAt ?? '') > Date.parse(at))) return taken;
        const report = latest?.report;
        const later = ticket.inputs.some((input)=>input.kind !== 'policy-changed' && Date.parse(input.at) > Date.parse(report?.at ?? ''));
        return report?.state !== 'ready' || ticket.undelivered.length > 0 || later;
    }
    newAssignment(ticket) {
        const assignment = {
            id: key('assignment', ticket.id, String(ticket.assignments.length)),
            state: 'pending',
            createdAt: this.now()
        };
        ticket.assignments.push(assignment);
        delete ticket.delivery;
        return assignment;
    }
    endAssignment(ticket, assignment, reason) {
        assignment.state = 'ended';
        assignment.endedAt = this.now();
        assignment.endedReason = reason;
        this.emit('assignment.ended', {
            ticketId: ticket.id,
            assignmentId: assignment.id,
            reason
        });
    }
    note(ticketId, text) {
        const ticket = this.require(ticketId);
        if (!liveTicket(ticket)) throw new UserError('ticketEnded');
        const at = this.now();
        this.addInput(ticket, {
            id: key('input', ticketId, 'note', at, text),
            kind: 'note',
            text,
            at
        });
        return this.require(ticketId);
    }
    followForContext(ticketId, ref) {
        if (!liveTicket(this.require(ticketId))) throw new UserError('ticketEnded');
        if (this.thread(ref).subscriptions.includes(ticketId)) return false;
        this.subscribe(ticketId, ref);
        const thread = this.thread(ref);
        thread.context = [
            ...thread.context ?? [],
            ticketId
        ];
        this.repo.threads.save(thread);
        return true;
    }
    subscribe(ticketId, ref) {
        const thread = this.thread(ref);
        if (!thread.subscriptions.includes(ticketId)) {
            thread.subscriptions.push(ticketId);
            this.emit('thread.subscribed', {
                threadKey: thread.key,
                ticketId
            });
        }
        if (thread.context?.includes(ticketId)) thread.context = thread.context.filter((id)=>id !== ticketId);
        this.repo.threads.save(thread);
    }
}
