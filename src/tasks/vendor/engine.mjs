// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { UserError } from './errors.mjs';
import { isoTime, liveTicket } from './model.mjs';
import { Assignments } from './assignments.mjs';
import { Evals } from './evals.mjs';
import { Intake } from './intake.mjs';
import { Replies } from './replies.mjs';
import { Tickets } from './tickets.mjs';
export class Engine {
    options;
    repo;
    replies;
    tickets;
    assignments;
    evals;
    intake;
    constructor(options){
        this.options = options;
        this.repo = options.repo;
        this.replies = new Replies(options);
        this.tickets = new Tickets(options, this.replies);
        this.assignments = new Assignments(options, this.tickets, this.replies);
        this.evals = new Evals(options, this.tickets);
        this.intake = new Intake(options, this.tickets);
    }
    receive(trigger) {
        return this.repo.atomic(()=>this.intake.receive(trigger));
    }
    bindThread(ticketId, thread, own) {
        return this.repo.atomic(()=>this.tickets.bind(ticketId, thread, own));
    }
    threadClosed(thread, outcome, at) {
        this.repo.atomic(()=>{
            this.tickets.threadClosed(thread, outcome, isoTime(at));
        });
    }
    evaluateDue() {
        const policy = this.options.policy();
        for (const thread of this.repo.threads.active())if (thread.evaluating) this.repo.atomic(()=>{
            this.evals.due(thread, policy);
        });
        if (policy.paused) return;
        for (const ticket of this.repo.tickets.active()){
            if (!liveTicket(ticket) && ticket.undelivered.length) this.repo.atomic(()=>{
                this.tickets.wake(ticket.id);
            });
        }
        for (const thread of this.repo.threads.active()){
            if (thread.pending.length && !thread.evaluating) this.repo.atomic(()=>{
                this.evals.start(thread.key, policy);
            });
        }
    }
    candidate(triggerId) {
        return this.evals.candidate(triggerId);
    }
    decide(triggerId, outcome) {
        return this.repo.atomic(()=>this.evals.decide(triggerId, outcome));
    }
    attach(ticketId, triggerId, note) {
        return this.repo.atomic(()=>{
            const handedBack = this.repo.triggers.disposition(triggerId)?.handbacks?.some((item)=>item.ticketId === ticketId);
            if (handedBack) throw new UserError('handedBackHere');
            const trigger = this.tickets.attachable(ticketId, triggerId);
            this.evals.withdraw(trigger);
            this.tickets.attach(ticketId, trigger, note);
            this.evals.routed(triggerId, ticketId);
            this.tickets.wake(ticketId);
            return this.repo.tickets.get(ticketId);
        });
    }
    requestStatus(ticketId) {
        return this.repo.atomic(()=>this.tickets.requestStatus(ticketId));
    }
    reply(request) {
        return this.repo.atomic(()=>this.replies.reply(request));
    }
    candidateDelivered(evalId) {
        this.repo.atomic(()=>{
            this.evals.delivered(evalId, this.options.policy());
        });
    }
    reevaluate(triggerId) {
        return this.repo.atomic(()=>this.evals.reevaluate(triggerId));
    }
    dismiss(decisionId) {
        return this.repo.atomic(()=>this.evals.dismiss(decisionId));
    }
    unsubscribe(thread) {
        return this.repo.atomic(()=>this.tickets.dropSubscriptions(thread, 'person'));
    }
    stopTicket(ticketId, reason) {
        return this.repo.atomic(()=>this.tickets.stop(ticketId, reason));
    }
    retryTicket(ticketId) {
        return this.repo.atomic(()=>this.tickets.retry(ticketId));
    }
    assignmentStarted(ticketId, assignmentId) {
        this.repo.atomic(()=>{
            this.assignments.started(ticketId, assignmentId);
        });
    }
    inputsDelivered(ticketId, assignmentId, inputIds) {
        this.repo.atomic(()=>{
            this.assignments.delivered(ticketId, assignmentId, inputIds);
        });
    }
    inputsRead(ticketId, inputIds) {
        this.repo.atomic(()=>{
            this.assignments.read(ticketId, inputIds);
        });
    }
    turnEnded(ticketId, assignmentId) {
        this.repo.atomic(()=>{
            this.assignments.turnEnded(ticketId, assignmentId);
        });
    }
    deliveryFailed(ticketId, assignmentId, error) {
        this.repo.atomic(()=>{
            this.assignments.deliveryFailed(ticketId, assignmentId, error);
        });
    }
    markUnrelated(ticketId, thread, reason) {
        this.repo.atomic(()=>{
            this.tickets.markUnrelated(ticketId, thread, reason);
        });
    }
    followForContext(ticketId, thread) {
        return this.repo.atomic(()=>this.tickets.followForContext(ticketId, thread));
    }
    note(ticketId, text) {
        return this.repo.atomic(()=>this.tickets.note(ticketId, text));
    }
    handback(ticketId, triggerId, reason) {
        return this.repo.atomic(()=>this.evals.handback(ticketId, triggerId, reason));
    }
    report(ticketId, report) {
        return this.repo.atomic(()=>this.assignments.report(ticketId, report));
    }
    assignmentInterrupted(ticketId, assignmentId) {
        this.repo.atomic(()=>{
            this.assignments.interrupted(ticketId, assignmentId);
        });
    }
    policyChanged(from, to, effects = new Map()) {
        this.repo.atomic(()=>{
            this.tickets.policyChanged(from, to, effects);
            this.evals.policyChanged(from, to);
        });
    }
}
