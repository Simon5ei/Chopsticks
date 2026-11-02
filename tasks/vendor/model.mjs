// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
export const threadKey = (ref)=>`${ref.source}:${ref.id}`;
export function isoTime(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : value;
}
export function followupOwners(trigger, records) {
    if (!trigger.human) return [];
    const disposition = records.triggers.disposition(trigger.id);
    if (!disposition || disposition.requeued) return [];
    const returned = new Set(disposition.handbacks?.map((item)=>item.ticketId));
    const reached = disposition.fanout.filter((id)=>!returned.has(id) && !disposition.context?.includes(id));
    if (!reached.length || records.threads.get(threadKey(trigger.threads[0]))?.evaluating?.triggerIds.includes(trigger.id)) return [];
    return reached.filter((id)=>{
        const ticket = records.tickets.get(id);
        return !!ticket && (liveTicket(ticket) || ticket.ended?.by !== 'human' && ticket.inputs.some((input)=>input.kind === 'trigger' && input.triggerId === trigger.id && ticket.undelivered.includes(input.id)));
    });
}
export const settled = (decision)=>![
        'stop',
        'unavailable'
    ].includes(decision.kind) && !decision.reason.some((reason)=>[
            'stopNotExplicit',
            'stopUnknown',
            'routed'
        ].includes(reason.code));
export const liveTicket = (ticket)=>!ticket.ended;
export const ticketOutcome = (ticket)=>ticket.ended?.outcome;
export const runningAssignment = (ticket)=>ticket.assignments.find((assignment)=>assignment.state === 'running');
export function reached(ticket, trigger, thread, context = true) {
    if (ticket.origin.triggerId === trigger.id) return true;
    const input = ticket.inputs.some((item)=>item.kind === 'trigger' && item.triggerId === trigger.id);
    return trigger.threads.some((ref)=>{
        const current = thread(threadKey(ref));
        return current?.subscriptions.includes(ticket.id) === true && (context || !current.context?.includes(ticket.id));
    }) || input && (context || !trigger.threads.every((ref)=>thread(threadKey(ref))?.context?.includes(ticket.id)));
}
export const latestAssignment = (ticket)=>ticket.assignments.at(-1);
export const latestReport = (ticket)=>ticket.assignments.findLast((assignment)=>assignment.report)?.report;
export function readUntil(ticket, progress = true) {
    const report = ticket.assignments.findLast((assignment)=>assignment.report && (progress || assignment.report.state !== 'progress'))?.report;
    return [
        report?.at ?? '',
        ...ticket.assignments.map((assignment)=>assignment.idleAt ?? '')
    ].reduce((a, b)=>a > b ? a : b);
}
export function waitsForPerson(ticket) {
    const report = latestAssignment(ticket)?.report;
    if (report?.state !== 'blocked' && report?.state !== 'failed') return false;
    return !ticket.inputs.some((input)=>input.kind === 'trigger' && input.human && !input.context && input.at > report.at);
}
