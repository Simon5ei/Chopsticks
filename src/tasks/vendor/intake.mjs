// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { key } from './ids.mjs';
import { isoTime, liveTicket, threadKey } from './model.mjs';
import { EnginePart } from './part.mjs';
export class Intake extends EnginePart {
    tickets;
    constructor(options, tickets){
        super(options), this.tickets = tickets;
    }
    receive(received) {
        const trigger = {
            ...received,
            at: isoTime(received.at)
        };
        if (!trigger.threads.length) throw new Error('A trigger must belong to at least one thread');
        if (this.repo.triggers.get(trigger.id)) return 'duplicate';
        const at = this.now();
        const filter = this.options.scope.scope(trigger);
        if (!filter.listened) {
            this.repo.triggers.save(trigger);
            this.repo.triggers.saveDisposition(trigger.id, {
                filtered: {
                    code: filter.reason
                },
                fanout: [],
                at
            });
            return 'filtered';
        }
        this.repo.triggers.save(trigger);
        const keys = trigger.threads.map(threadKey);
        const reached = new Map();
        for (const ref of trigger.threads){
            const thread = this.thread(ref);
            if (!thread.lastAt || trigger.at > thread.lastAt) thread.lastAt = trigger.at;
            thread.correlated = [
                ...new Set([
                    ...thread.correlated,
                    ...keys.filter((other)=>other !== thread.key)
                ])
            ];
            for (const ticketId of thread.subscriptions){
                const ticket = this.repo.tickets.get(ticketId);
                const followed = !!thread.context?.includes(ticketId);
                const resumes = trigger.human && ticket?.ended?.by !== 'human' && !followed;
                if (!ticket || !liveTicket(ticket) && !resumes) continue;
                reached.set(ticketId, {
                    ticket,
                    context: followed && (reached.get(ticketId)?.context ?? true)
                });
            }
            this.repo.threads.save(thread);
        }
        for (const [ticketId, { ticket, context: followed }] of reached){
            this.tickets.addInput(ticket, {
                id: key('input', ticketId, 'trigger', trigger.id),
                kind: 'trigger',
                triggerId: trigger.id,
                at,
                ...trigger.human ? {
                    human: true
                } : {},
                ...followed ? {
                    context: true
                } : {}
            });
        }
        const fanout = [
            ...reached.keys()
        ], context = fanout.filter((id)=>reached.get(id).context);
        const disposition = {
            fanout,
            ...context.length ? {
                context
            } : {},
            at
        };
        this.repo.triggers.saveDisposition(trigger.id, disposition);
        if (!this.owners(trigger).length) this.queueForEval(trigger);
        for (const ticketId of fanout)this.tickets.wake(ticketId);
        this.emit('trigger.received', {
            triggerId: trigger.id,
            threads: trigger.threads.map(threadKey)
        });
        return 'stored';
    }
}
