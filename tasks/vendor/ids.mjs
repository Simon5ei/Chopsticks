// Generated from DeepSeek Harness Team MIT core; see PROVENANCE.json and LICENSE.
import { createHash } from 'node:crypto';
export function key(...values) {
    return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32);
}
