// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { key } from './ids.mjs';
import { UserError } from './errors.mjs';
import { latestAssignment, liveTicket, ticketOutcome } from './model.mjs';
import { EnginePart } from './part.mjs';
export class Replies extends EnginePart {
    reply(request) {
        return request.purpose === 'acknowledgement' ? this.acknowledge(request) : this.answer(request);
    }
    acknowledgeAccepted(ticketId, trigger, text) {
        if (trigger.channel && trigger.human) this.options.outbox.send({
            id: key('ack', trigger.id),
            channel: trigger.channel,
            text,
            kind: 'acknowledgement',
            ticketId
        });
    }
    withdrawAttention(attentionId) {
        this.options.outbox.withdraw(key('attention-reply', attentionId));
    }
    acknowledge(request) {
        const ticket = this.require(request.ticketId);
        if (!liveTicket(ticket)) throw new UserError('ackEnded');
        const trigger = this.repo.triggers.get(request.triggerId);
        if (!trigger) throw new UserError('unknownTrigger');
        if (!this.reaches(ticket, trigger, false)) throw new UserError('notReached');
        if (!trigger.channel) throw new UserError('ackNoChannel');
        const id = key('ack', trigger.id);
        const existing = this.options.outbox.status(id);
        if (!existing && !trigger.human) throw new UserError('ackNotPerson');
        if (!existing) this.options.outbox.send({
            id,
            channel: trigger.channel,
            text: request.text,
            kind: 'acknowledgement',
            ticketId: ticket.id
        });
        this.takeUp(ticket.id, trigger.id);
        return {
            id,
            status: this.options.outbox.status(id) ?? 'pending',
            reused: existing !== undefined
        };
    }
    answer(request) {
        const trigger = request.triggerId ? this.repo.triggers.get(request.triggerId) : undefined;
        if (request.triggerId && !trigger) throw new UserError('unknownTrigger');
        const ticket = request.ticketId ? this.require(request.ticketId) : trigger ? this.repo.tickets.list().find((item)=>this.reaches(item, trigger)) : undefined;
        if (request.purpose === 'result') {
            const outcome = ticket && ticketOutcome(ticket);
            const reported = !!ticket && liveTicket(ticket) && latestAssignment(ticket)?.report?.state === 'ready';
            const ready = outcome === 'merged' || outcome === 'completed' || outcome === 'dropped' || reported;
            if (!ticket || !ready) throw new UserError('notReady');
        }
        const attention = request.purpose === 'attention' ? ticket?.attention : undefined;
        if (request.purpose === 'attention' && (!attention || attention.question !== request.question)) throw new UserError('notAttention');
        if (request.purpose === 'answer' && !trigger?.human) throw new UserError('notQuestion');
        const id = attention ? key('attention-reply', attention.id) : key('reply', trigger?.id ?? ticket?.id ?? '', request.text);
        const existing = this.options.outbox.status(id);
        const ready = !ticket || !trigger || ticket.answers?.includes(trigger.id);
        if (request.purpose === 'answer' && !ready && !existing) throw new UserError('noAnswer');
        const asker = attention?.triggerId ? this.repo.triggers.get(attention.triggerId) : undefined;
        const channel = request.purpose === 'answer' ? trigger.channel : asker?.channel ?? (ticket ? this.sourceChannel(ticket) : undefined);
        if (!channel) throw new UserError('noChannel');
        this.options.outbox.send({
            id,
            channel,
            text: request.text,
            kind: 'reply',
            ...ticket ? {
                ticketId: ticket.id
            } : {}
        });
        if (request.purpose === 'answer' && ticket && trigger && ticket.answers?.includes(trigger.id)) {
            ticket.answers = ticket.answers.filter((item)=>item !== trigger.id);
            this.repo.tickets.save(ticket);
        }
        return {
            id,
            status: this.options.outbox.status(id) ?? 'pending',
            reused: existing !== undefined
        };
    }
    sourceChannel(ticket) {
        return this.source(ticket)?.channel ?? ticket.channels[0];
    }
}
