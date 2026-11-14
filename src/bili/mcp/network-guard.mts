// Preloaded only in the bounded command process, never changes host fetch.
import { guardedFetch } from './network.mjs';
const budget=process.env.CHOPSTICKS_BILI_READ_BUDGET;
globalThis.fetch = guardedFetch(globalThis.fetch,budget==='frames'?{maxBytes:12*1024*1024}:
 budget==='text'?{maxBytes:512*1024}:{});
