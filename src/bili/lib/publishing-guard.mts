import fs from 'node:fs';
import { config } from './config.mjs';
import { biliState } from './state-paths.mjs';

export function assertPublishingAccount(account?: any) {
  const expected=String(config().self?.mid ?? '');
  const actual=String(account?.mid ?? '');
  if (!/^[1-9][0-9]{0,19}$/.test(expected) || expected !== actual) {
    throw new Error('Bili account identity does not match configured self.mid; publishing refused');
  }
}

function readLedger(name?: any, fallback?: any) {
  try {
    const value=JSON.parse(fs.readFileSync(biliState(name),'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ledger');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error('Dynamic cooldown ledger unreadable; publishing refused');
  }
}

export function assertDynamicAllowed({auto=false,now=Date.now()}: { auto?: boolean; now?: any; [key: string]: any }={}) {
  const settings=config().dynamics;
  if (settings?.enabled === false) throw new Error('Dynamic publishing is disabled');
  if (!auto) return;
  const gapMin=Number(settings?.gapMin ?? 30);
  if (!Number.isFinite(gapMin) || gapMin < 0) throw new Error('Invalid dynamic gapMin; publishing refused');
  const quota=readLedger('quota.json',{log:[]});
  if (!Array.isArray(quota.log)) throw new Error('Dynamic cooldown ledger invalid; publishing refused');
  const legacy=readLedger('daily-dynamic.json',{});
  const records=[...quota.log.filter((item)=>item?.type === 'dynamic'),...Object.values(legacy).filter((item: any) =>item?.at)];
  let latest=0;
  for (const item of records) {
    const at=Date.parse(item.at);
    if (!Number.isFinite(at)) throw new Error('Dynamic cooldown timestamp invalid; publishing refused');
    latest=Math.max(latest,at);
  }
  if (latest && now-latest < gapMin*60000) throw new Error('Dynamic cooldown active; publishing refused');
}
