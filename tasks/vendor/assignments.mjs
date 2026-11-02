// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { key } from './ids.mjs';
import { UserError } from './errors.mjs';
import { latestAssignment, liveTicket, runningAssignment } from './model.mjs';
import { EnginePart } from './part.mjs';
import { automatic } from './tickets.mjs';
const RECOVERY_NOTE = 'The host restarted during this ticket. Inspect the current worktree, git history and GitHub state before continuing. Do not repeat an already completed external operation. Finish the original assignment and report its status.';
export class Assignments extends EnginePart {
    tickets;
    replies;
    constructor(options, tickets, replies){
        super(options), this.tickets = tickets, this.replies = replies;
    }
    started(ticketId, assignmentId) {
        const ticket = this.require(ticketId);
        const assignment = ticket.assignments.find((item)=>item.id === assignmentId);
        if (!assignment || assignment.state === 'ended') return;
        assignment.state = 'running';
        assignment.startedAt ??= this.now();
        ticket.updatedAt = this.now();
        this.repo.tickets.save(ticket);
        if (liveTicket(ticket) && ticket.undelivered.length) this.options.executor.deliver(ticket, assignment);
        this.emit('assignment.started', {
            ticketId,
            assignmentId
        });
    }
    delivered(ticketId, assignmentId, inputIds) {
        const ticket = this.running(ticketId, assignmentId);
        if (!ticket) return;
        ticket.undelivered = ticket.undelivered.filter((id)=>!inputIds.includes(id));
        ticket.updatedAt = this.now();
        runningAssignment(ticket).deliveredAt = ticket.updatedAt;
        for (const input of ticket.inputs){
            if (input.kind === 'trigger' && inputIds.includes(input.id)) {
                input.readAt ??= null;
                input.deliveredTo = assignmentId;
            }
        }
        delete ticket.delivery;
        this.repo.tickets.save(ticket);
    }
    read(ticketId, inputIds) {
        const ticket = this.require(ticketId);
        if (!liveTicket(ticket)) return;
        for (const input of ticket.inputs)if (input.kind === 'trigger' && inputIds.includes(input.id)) input.readAt ||= this.now();
        this.repo.tickets.save(ticket);
    }
    turnEnded(ticketId, assignmentId) {
        const ticket = this.running(ticketId, assignmentId);
        if (!ticket) return;
        runningAssignment(ticket).idleAt = this.now();
        this.repo.tickets.save(ticket);
    }
    deliveryFailed(ticketId, assignmentId, error) {
        const ticket = this.running(ticketId, assignmentId);
        if (!ticket) return;
        ticket.delivery = {
            error: error.slice(0, 300),
            at: this.now()
        };
        this.repo.tickets.save(ticket);
    }
    interrupted(ticketId, assignmentId) {
        const ticket = this.running(ticketId, assignmentId);
        const running = ticket && runningAssignment(ticket);
        if (!ticket || !running) return;
        const report = running.report;
        const busy = !!running.deliveredAt && !!report && running.deliveredAt >= report.at;
        const settled = !!report && [
            'waiting',
            'ready',
            'blocked',
            'failed'
        ].includes(report.state) && !busy;
        if (!settled) this.tickets.restart(ticket, running, 'hostRestarted', RECOVERY_NOTE);
        else if (ticket.undelivered.length) this.options.executor.deliver(ticket, running);
    }
    report(ticketId, report) {
        const ticket = this.require(ticketId);
        if (!liveTicket(ticket)) throw new UserError('ticketEnded');
        if (report.question && (report.state === 'ready' || report.answers)) throw new UserError('questionWithResult');
        if (report.askedBy && !report.question) throw new UserError('askerWithoutQuestion');
        const person = (id, channel)=>{
            const trigger = this.repo.triggers.get(id);
            return !!trigger?.human && (!channel || !!trigger.channel) && this.reaches(ticket, trigger, false);
        };
        if (report.askedBy && !person(report.askedBy, true)) throw new UserError('notAsker');
        if (report.answers && !person(report.answers, false)) throw new UserError('notAnswerable');
        const assignment = runningAssignment(ticket) ?? latestAssignment(ticket);
        if (!assignment) throw new UserError('unknownAssignment');
        if (assignment.state === 'ended') throw new UserError('assignmentEnded');
        const at = this.now();
        const previous = ticket.attention;
        const ask = (question)=>({
                id: key('attention', ticketId, question, at),
                question,
                ...report.askedBy ? {
                    triggerId: report.askedBy
                } : {}
            });
        const asked = report.question && report.question !== previous?.question ? ask(report.question) : previous;
        const attention = report.question === null || report.state === 'ready' ? undefined : asked;
        if (attention) ticket.attention = attention;
        else delete ticket.attention;
        if (previous && previous.id !== attention?.id) this.replies.withdrawAttention(previous.id);
        assignment.report = {
            state: report.state,
            summary: report.summary,
            at
        };
        ticket.updatedAt = at;
        if (report.answers && !ticket.answers?.includes(report.answers)) ticket.answers = [
            ...ticket.answers ?? [],
            report.answers
        ];
        if (report.answers) this.takeUp(ticketId, report.answers);
        if (report.state === 'blocked' || report.state === 'failed') ticket.undelivered = ticket.undelivered.filter((id)=>!automatic(ticket.inputs.find((input)=>input.id === id)));
        this.repo.tickets.save(ticket);
        const ready = !ticket.follows?.length ? 'completed' : this.tickets.followsDone(ticket)?.outcome;
        const outcome = report.state === 'dropped' ? this.tickets.followsDone(ticket)?.outcome ?? 'dropped' : report.state === 'ready' ? ready : undefined;
        if (outcome) this.tickets.end(ticketId, 'executor', outcome, at);
        return this.require(ticketId);
    }
    running(ticketId, assignmentId) {
        const ticket = this.require(ticketId);
        return liveTicket(ticket) && runningAssignment(ticket)?.id === assignmentId ? ticket : undefined;
    }
}
