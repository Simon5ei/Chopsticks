// Fixed, non-private failure reasons: never echo platform bodies, tickets or peer data.
export function platformFailure(error?: any) {
 const name = String(error?.name || ''), message = String(error?.message || '');
 const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined;
 if (code) return { ok: false, code, message: 'The platform rejected this operation.' };
 if (name === 'ZodError') return { ok: false, code: 'INVALID_ARGUMENT', message: 'Arguments do not match the tool schema.' };
 if (/ticket/i.test(message)) return { ok: false, code: 'TICKET_REJECTED', message: 'The ticket is not valid for this turn.' };
 if (/held/i.test(message)) return { ok: false, code: 'OPERATION_HELD', message: 'An earlier failure paused this operation.' };
 if (/inactive|interrupted/i.test(message)) return { ok: false, code: 'TURN_INACTIVE', message: 'The platform turn is no longer active.' };
 if (/refused|denied|not allowed/i.test(message)) return { ok: false, code: 'PLATFORM_REFUSED', message: 'The platform owner refused this operation.' };
 if (/timed?\s?out/i.test(message)) return { ok: false, code: 'PLATFORM_TIMEOUT', message: 'The platform did not answer in time.' };
 if (/ENOTFOUND|ECONN|network|fetch failed/i.test(message)) return { ok: false, code: 'PLATFORM_UNAVAILABLE', message: 'The platform could not be reached.' };
 return { ok: false, code: 'PLATFORM_ERROR', message: 'The platform operation failed.' };
}
