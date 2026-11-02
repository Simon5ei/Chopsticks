// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { key } from './ids.mjs';
import { UserError } from './errors.mjs';
import { liveTicket, threadKey } from './model.mjs';
import { said } from './reasons.mjs';
import { EnginePart } from './part.mjs';
const reasonOf = (reason)=>[
        typeof reason === 'string' ? said(reason) : reason
    ];
const stronger = (a, b)=>a === 'explicit' || b === 'explicit' ? 'explicit' : 'inferred';
const REQUEUES = 2;
export class Evals extends EnginePart {
    tickets;
    constructor(options, tickets){
        super(options), this.tickets = tickets;
    }
    due(thread, policy) {
        const evaluation = thread.evaluating;
        if (!evaluation || policy.paused && evaluation.pausedAt) return;
        const now = this.now();
        if (policy.paused) evaluation.pausedAt = now;
        else if (evaluation.pausedAt) {
            evaluation.deadline = new Date(Date.parse(evaluation.deadline) + Date.parse(now) - Date.parse(evaluation.pausedAt)).toISOString();
            delete evaluation.pausedAt;
        } else if (evaluation.delivered && evaluation.deadline <= now) {
            this.expire(thread);
            return;
        } else return;
        this.repo.threads.save(thread);
    }
    delivered(evalId, policy) {
        const thread = this.repo.threads.active().find((item)=>item.evaluating?.id === evalId);
        if (!thread?.evaluating || thread.evaluating.delivered) return;
        const now = this.now();
        thread.evaluating.delivered = now;
        thread.evaluating.deadline = new Date(Date.parse(now) + policy.evalTimeoutMs).toISOString();
        this.repo.threads.save(thread);
    }
    expire(thread) {
        const expired = (thread.expired ?? 0) + 1;
        if (expired > REQUEUES) {
            this.finish(thread, thread.evaluating, {
                kind: 'unavailable',
                reason: [
                    {
                        code: 'timeout'
                    }
                ]
            });
            return;
        }
        const { id, triggerIds } = thread.evaluating;
        delete thread.evaluating;
        thread.expired = expired;
        thread.pending = [
            ...triggerIds,
            ...thread.pending.filter((item)=>!triggerIds.includes(item))
        ];
        this.repo.threads.save(thread);
        this.options.assessor.release?.(id);
    }
    start(threadKeyValue, policy) {
        const thread = this.repo.threads.get(threadKeyValue);
        const at = this.now();
        const delivered = (id)=>{
            const trigger = this.repo.triggers.get(id);
            return !!trigger && this.owners(trigger).length > 0;
        };
        if (thread.pending.some(delivered)) {
            const followups = thread.pending.filter(delivered);
            thread.pending = thread.pending.filter((id)=>!followups.includes(id));
            this.repo.threads.save(thread);
            for (const triggerId of followups)this.emit('trigger.followup', {
                triggerId
            });
            if (!thread.pending.length) return;
        }
        const accepted = this.accepted(thread.key);
        const started = thread.pending.filter((id)=>accepted.has(id));
        const startedTicket = (id)=>({
                code: 'startedTicket',
                triggerId: id,
                values: {
                    ticket: accepted.get(id).ticketId
                }
            });
        if (started.length) this.ignore(thread, started, started.map(startedTicket), policy, at);
        const triggers = thread.pending.flatMap((id)=>{
            const trigger = this.repo.triggers.get(id);
            return trigger ? [
                trigger
            ] : [];
        });
        const tickets = this.ticketsOnThread(thread);
        const reasons = [];
        let strongest;
        for (const trigger of triggers){
            const gate = policy.gate(trigger, thread, tickets);
            if (!gate.admissible) {
                reasons.push({
                    code: gate.reason,
                    triggerId: trigger.id
                });
                continue;
            }
            const later = gate.strength === strongest?.strength && trigger.at >= strongest.trigger.at;
            const weaker = !strongest || stronger(strongest.strength, gate.strength) !== strongest.strength;
            if (weaker || later) strongest = {
                trigger,
                strength: gate.strength,
                basis: gate.basis
            };
        }
        if (!strongest) {
            if (thread.pending.length) this.ignore(thread, [
                ...thread.pending
            ], reasons.length ? reasons : [
                {
                    code: 'noAdmissible'
                }
            ], policy, at);
            this.repo.threads.save(thread);
            return;
        }
        const evalId = key('eval', thread.key, policy.version, at, ...thread.pending);
        const deadline = new Date(Date.parse(at) + policy.evalTimeoutMs).toISOString();
        const { strength, trigger: { actor }, basis } = strongest;
        thread.evaluating = {
            id: evalId,
            threadKey: thread.key,
            triggerIds: thread.pending,
            primary: strongest.trigger.id,
            strength,
            actor,
            basis,
            policyVersion: policy.version,
            startedAt: at,
            deadline
        };
        thread.pending = [];
        this.repo.threads.save(thread);
        for (const trigger of triggers){
            this.repo.triggers.saveDisposition(trigger.id, {
                ...this.repo.triggers.disposition(trigger.id) ?? {
                    fanout: [],
                    at
                },
                evalId
            });
        }
        this.emit('eval.started', {
            evalId,
            threadKey: thread.key,
            triggerIds: thread.evaluating.triggerIds,
            strength: strongest.strength
        });
        this.options.assessor.request(this.candidateOf(thread));
    }
    candidate(triggerId) {
        const thread = this.holding(triggerId);
        return thread && this.candidateOf(thread);
    }
    decide(triggerId, outcome) {
        const trigger = this.repo.triggers.get(triggerId);
        if (!trigger) throw new UserError('unknownTrigger');
        const held = this.holding(triggerId);
        if (outcome.evalId && held?.evaluating?.id !== outcome.evalId) throw new UserError('evalFinished', {
            eval: outcome.evalId
        });
        const earlier = outcome.kind === 'accept' ? this.accepted(threadKey(trigger.threads[0])).get(triggerId) : undefined;
        if (earlier) {
            const others = held?.evaluating?.triggerIds.filter((id)=>id !== triggerId) ?? [];
            if (held && others.length) this.reassess(held, {
                code: 'acceptedBefore',
                values: {
                    trigger: triggerId
                }
            }, [
                triggerId
            ]);
            else if (held) {
                this.finish(held, held.evaluating, {
                    kind: 'ignore',
                    reason: [
                        {
                            code: 'startedTicket',
                            triggerId,
                            values: {
                                ticket: earlier.ticketId
                            }
                        }
                    ]
                });
            }
            return earlier;
        }
        if (outcome.kind !== 'stop') this.leftToWorkers(trigger);
        const thread = held ?? this.thread(trigger.threads[0]);
        const evaluation = held?.evaluating ?? this.directEval(thread, trigger, outcome.kind, outcome.kind === 'stop' ? outcome.ticketId : undefined);
        if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {
            throw new UserError('notExplicit');
        }
        return this.decideEval(thread, evaluation, outcome);
    }
    reevaluate(triggerId) {
        if (!this.requeue(triggerId)) return false;
        this.emit('trigger.requeued', {
            triggerId
        });
        return true;
    }
    requeue(triggerId) {
        const trigger = this.repo.triggers.get(triggerId);
        if (!trigger) throw new UserError('unknownTrigger');
        if (this.holding(triggerId)) return false;
        this.queueForEval(trigger);
        const disposition = this.repo.triggers.disposition(triggerId) ?? {
            fanout: [],
            at: this.now()
        };
        this.repo.triggers.saveDisposition(triggerId, {
            ...disposition,
            requeued: true
        });
        return true;
    }
    handback(ticketId, triggerId, reason) {
        const ticket = this.require(ticketId);
        if (!ticket.inputs.some((input)=>input.kind === 'trigger' && input.triggerId === triggerId)) throw new UserError('notReached');
        if (this.repo.triggers.disposition(triggerId)?.handbacks?.some((item)=>item.ticketId === ticketId)) throw new UserError('handedBack');
        return this.handBack(ticketId, this.repo.triggers.get(triggerId), reason);
    }
    dismiss(decisionId) {
        const decision = this.repo.decisions.get(decisionId);
        if (decision?.kind !== 'unavailable') throw new UserError('unknownProblem');
        decision.dismissed = true;
        this.repo.decisions.save(decision);
        return decision;
    }
    withdraw(trigger) {
        const thread = this.repo.threads.get(threadKey(trigger.threads[0]));
        if (!thread?.pending.includes(trigger.id)) return;
        thread.pending = thread.pending.filter((id)=>id !== trigger.id);
        this.repo.threads.save(thread);
    }
    routed(triggerId, ticketId) {
        const held = this.holding(triggerId);
        const reason = {
            code: 'routed',
            values: {
                ticket: ticketId
            }
        };
        if (held?.evaluating?.triggerIds.length === 1) this.finish(held, held.evaluating, {
            kind: 'ignore',
            reason: [
                reason
            ]
        });
        else if (held) this.reassess(held, {
            ...reason,
            triggerId
        }, [
            triggerId
        ]);
    }
    policyChanged(from, to) {
        for (const thread of this.repo.threads.active())if (thread.evaluating) this.reassess(thread, {
            code: 'policyChanged'
        });
        this.emit('policy.changed', {
            from,
            to
        });
    }
    reassess(thread, reason, without = []) {
        const ids = thread.evaluating.triggerIds.filter((id)=>!without.includes(id));
        const decision = this.finish(thread, thread.evaluating, {
            kind: 'unavailable',
            reason: [
                reason
            ]
        });
        const current = this.repo.threads.get(thread.key);
        current.pending = [
            ...ids,
            ...current.pending.filter((id)=>!ids.includes(id))
        ];
        this.repo.threads.save(current);
        return decision;
    }
    holding(triggerId) {
        const trigger = this.repo.triggers.get(triggerId);
        const thread = trigger && this.repo.threads.get(threadKey(trigger.threads[0]));
        return thread?.evaluating?.triggerIds.includes(triggerId) ? thread : undefined;
    }
    candidateOf(thread) {
        const evaluation = thread.evaluating;
        const triggers = evaluation.triggerIds.flatMap((id)=>{
            const trigger = this.repo.triggers.get(id);
            return trigger ? [
                trigger
            ] : [];
        });
        const { id: evalId, strength, policyVersion } = evaluation;
        return {
            evalId,
            thread,
            triggers,
            strength,
            policyVersion,
            tickets: this.ticketsOnThread(thread)
        };
    }
    ignore(thread, ids, reason, policy, at) {
        const evaluation = {
            id: key('eval', thread.key, 'ignored', policy.version, at, ...ids),
            threadKey: thread.key,
            triggerIds: ids,
            strength: 'inferred',
            actor: {
                source: thread.ref.source,
                id: ''
            },
            basis: {
                via: 'followup'
            },
            policyVersion: policy.version,
            startedAt: at,
            deadline: at
        };
        this.record(thread, evaluation, {
            kind: 'ignore',
            reason
        });
        thread.pending = thread.pending.filter((id)=>!ids.includes(id));
        delete thread.expired;
    }
    accepted(threadKey) {
        const accepted = new Map();
        for (const decision of this.repo.decisions.byThread(threadKey)){
            if (decision.kind !== 'accept' || !decision.ticketId) continue;
            for (const id of decision.triggerIds)if (!accepted.has(id)) accepted.set(id, decision);
        }
        return accepted;
    }
    directEval(thread, trigger, kind, ticketId) {
        const policy = this.policy();
        const gate = policy.gate(trigger, thread, this.ticketsOnThread(thread));
        if (!gate.admissible) throw new UserError('notAdmissible', {
            reason: gate.reason
        });
        const at = this.now();
        if (thread.pending.includes(trigger.id)) {
            thread.pending = thread.pending.filter((id)=>id !== trigger.id);
            this.repo.threads.save(thread);
        }
        const id = key('eval', thread.key, 'direct', trigger.id, kind, ...ticketId ? [
            ticketId
        ] : [], at);
        return {
            id,
            threadKey: thread.key,
            triggerIds: [
                trigger.id
            ],
            primary: trigger.id,
            strength: gate.strength,
            actor: trigger.actor,
            basis: gate.basis,
            policyVersion: policy.version,
            startedAt: at,
            deadline: at
        };
    }
    decideEval(thread, evaluation, outcome) {
        const audit = outcome.audit ? {
            audit: outcome.audit
        } : {};
        if (this.policy().version !== evaluation.policyVersion) {
            if (thread.evaluating?.id === evaluation.id) return this.reassess(thread, {
                code: 'policyChanged'
            });
            return this.finish(thread, evaluation, {
                kind: 'unavailable',
                reason: [
                    {
                        code: 'policyChanged'
                    }
                ],
                ...audit
            });
        }
        const unassessed = outcome.kind === 'ignore' && evaluation.strength !== 'explicit' && !outcome.audit ? [
            {
                code: 'ignoredFromCard'
            }
        ] : [];
        if (outcome.kind === 'ignore' || outcome.kind === 'unavailable') return this.finish(thread, evaluation, {
            kind: outcome.kind,
            reason: [
                ...unassessed,
                ...reasonOf(outcome.reason)
            ],
            ...audit
        });
        if (outcome.kind === 'stop') {
            const ticket = this.repo.tickets.get(outcome.ticketId);
            if (!ticket || !liveTicket(ticket)) return this.finish(thread, evaluation, {
                kind: 'ignore',
                reason: [
                    {
                        code: 'stopUnknown'
                    }
                ],
                ...audit
            });
            if (evaluation.strength !== 'explicit') return this.finish(thread, evaluation, {
                kind: 'ignore',
                reason: [
                    {
                        code: 'stopNotExplicit'
                    }
                ],
                ...audit
            });
            const decision = this.finish(thread, evaluation, {
                kind: 'stop',
                reason: reasonOf(outcome.reason),
                ticketId: ticket.id,
                ...audit
            });
            this.tickets.end(ticket.id, 'human', 'stopped', this.now(), typeof outcome.reason === 'string' ? outcome.reason : undefined);
            return decision;
        }
        return this.accept(thread, evaluation, outcome);
    }
    accept(thread, evaluation, outcome) {
        const at = this.now();
        const basis = {
            ...evaluation.basis,
            ...outcome.rules ? {
                rules: outcome.rules
            } : {}
        };
        const { strength, policyVersion, actor } = evaluation;
        const mandate = {
            strength,
            policyVersion,
            basis,
            actor,
            scope: outcome.scope
        };
        const ticketId = key('ticket', evaluation.id);
        const audit = outcome.audit ? {
            audit: outcome.audit
        } : {};
        const decision = this.finish(thread, evaluation, {
            kind: 'accept',
            reason: reasonOf(outcome.reason),
            ...audit,
            mandate,
            ticketId
        });
        this.tickets.create(ticketId, decision.id, mandate, evaluation, outcome, at);
        return decision;
    }
    finish(thread, evaluation, outcome) {
        const decision = this.record(thread, evaluation, outcome);
        if (thread.evaluating?.id !== evaluation.id) return decision;
        delete thread.evaluating;
        delete thread.expired;
        this.repo.threads.save(thread);
        this.options.assessor.release?.(evaluation.id);
        return decision;
    }
    record(thread, evaluation, outcome) {
        const at = this.now();
        const decision = {
            id: key('decision', evaluation.id),
            evalId: evaluation.id,
            threadKey: thread.key,
            triggerIds: evaluation.triggerIds,
            policyVersion: evaluation.policyVersion,
            at,
            kind: outcome.kind,
            reason: outcome.reason,
            strength: evaluation.strength,
            ...outcome.ticketId ? {
                ticketId: outcome.ticketId
            } : {},
            ...outcome.mandate ? {
                mandate: outcome.mandate
            } : {},
            ...outcome.audit ? {
                audit: outcome.audit
            } : {}
        };
        this.repo.decisions.save(decision);
        for (const id of evaluation.triggerIds){
            const disposition = this.repo.triggers.disposition(id) ?? {
                fanout: [],
                at
            };
            this.repo.triggers.saveDisposition(id, {
                ...disposition,
                evalId: evaluation.id,
                decisionId: decision.id
            });
        }
        this.emit('decision.recorded', {
            decisionId: decision.id,
            kind: decision.kind,
            threadKey: thread.key
        });
        return decision;
    }
}
