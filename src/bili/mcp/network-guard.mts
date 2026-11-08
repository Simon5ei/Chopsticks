// Preloaded only in the bounded command process, never changes host fetch.
import { guardedFetch } from './network.mjs';
globalThis.fetch = guardedFetch(globalThis.fetch);
