// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { UserError } from './errors.mjs';
import { followupOwners, reached, threadKey } from './model.mjs';
export class EnginePart {
    options;
    repo;
    constructor(options){
        this.options = options;
        this.repo = options.repo;
    }
    now() {
        return this.options.now?.() ?? new Date().toISOString();
    }
    policy() {
        return this.options.policy();
    }
    owners(trigger) {
        return followupOwners(trigger, this.repo);
    }
    leftToWorkers(trigger) {
        const owners = this.owners(trigger);
        if (owners.length) throw new UserError('workerDecides', {
            tickets: owners.join(', ')
        });
    }
    handBack(ticketId, trigger, reason) {
        const decided = this.owners(trigger).includes(ticketId);
        const disposition = this.repo.triggers.disposition(trigger.id) ?? {
            fanout: [],
            at: this.now()
        };
        const handbacks = [
            ...disposition.handbacks ?? [],
            {
                ticketId,
                reason,
                at: this.now()
            }
        ];
        this.repo.triggers.saveDisposition(trigger.id, {
            ...disposition,
            handbacks
        });
        return decided && !this.owners(trigger).length && this.queueForEval(trigger);
    }
    takeUp(ticketId, triggerId) {
        const disposition = this.repo.triggers.disposition(triggerId);
        if (disposition && !disposition.acked?.includes(ticketId)) {
            this.repo.triggers.saveDisposition(triggerId, {
                ...disposition,
                acked: [
                    ...disposition.acked ?? [],
                    ticketId
                ]
            });
        }
    }
    queueForEval(trigger) {
        const primary = this.thread(trigger.threads[0]);
        if (primary.pending.includes(trigger.id) || primary.evaluating?.triggerIds.includes(trigger.id)) return false;
        primary.pending.push(trigger.id);
        this.repo.threads.save(primary);
        return true;
    }
    emit(type, data) {
        this.options.emit?.({
            type,
            at: this.now(),
            data
        });
    }
    require(ticketId) {
        const ticket = this.repo.tickets.get(ticketId);
        if (!ticket) throw new UserError('unknownTicket');
        return ticket;
    }
    thread(ref) {
        const k = threadKey(ref);
        return this.repo.threads.get(k) ?? {
            key: k,
            ref: {
                source: ref.source,
                id: ref.id
            },
            createdAt: this.now(),
            subscriptions: [],
            correlated: [],
            pending: [],
            meta: {}
        };
    }
    ticketsOnThread(thread) {
        return thread.subscriptions.flatMap((id)=>{
            const ticket = this.repo.tickets.get(id);
            return ticket ? [
                ticket
            ] : [];
        });
    }
    source(ticket) {
        return this.repo.triggers.get(ticket.origin.triggerId);
    }
    reaches(ticket, trigger, context = true) {
        return reached(ticket, trigger, (k)=>this.repo.threads.get(k), context);
    }
}
