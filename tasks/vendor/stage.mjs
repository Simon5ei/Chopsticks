// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { latestAssignment, waitsForPerson } from './model.mjs';
export function ticketStage(ticket) {
    if (ticket.ended) return {
        stage: 'ended'
    };
    if (ticket.delivery) return {
        stage: 'person',
        action: 'delivery'
    };
    if (ticket.attention) return {
        stage: 'person',
        action: 'answer'
    };
    const assignment = latestAssignment(ticket);
    const report = assignment?.report?.state;
    if (report === 'ready') return {
        stage: 'person',
        action: 'review'
    };
    if ((report === 'blocked' || report === 'failed') && waitsForPerson(ticket)) return {
        stage: 'person',
        action: report
    };
    if (!assignment || assignment.state === 'pending') return {
        stage: 'working',
        action: 'queued'
    };
    if (report === 'waiting' || assignment.state === 'ended') return {
        stage: 'idle'
    };
    return {
        stage: 'working'
    };
}
export function canRetry(ticket) {
    return !ticket.ended && (waitsForPerson(ticket) || !!ticket.delivery);
}
