// src/evals/fetch-assets.ts
// Downloads the market data every benchmark query is expected to need into the ignored
// evals/fixtures/ folder, so the benchmark can then run without network access.
//   node dist/evals/fetch-assets.js [--intervals 1d,1wk,1h]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { liveMarketData } from '../server.js';
import { isCrypto } from '../utils/helpers.js';
import { loadQueries, parseArgs, PATHS } from './common.js';
import { fixtureMarketData } from './fixtures.js';

const args = parseArgs(process.argv.slice(2));
const intervals = String(args.intervals ?? '1d,1wk,1h,5m').split(',');
const data = fixtureMarketData(liveMarketData, PATHS.fixtures, 'record');

const symbols = new Set<string>();
for (const q of loadQueries()) for (const group of q.expect.symbols) for (const s of group) symbols.add(s);

let ok = 0, failed = 0;
const failures: string[] = [];
const attempt = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); ok++; } catch (e) { failed++; failures.push(`${label}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
};

for (const s of [...symbols].sort()) {
  const crypto = isCrypto(s);
  await attempt(`${s} quote`, () => (crypto ? data.getCryptoPrice(s) : data.getStockPrice(s)));
  for (const iv of intervals) {
    await attempt(`${s} ${iv}`, () => (crypto ? data.getCryptoHistory(s, iv === '1wk' ? '1w' : iv, 10) : data.getStockHistory(s, iv, 10)));
  }
  if (!crypto) await attempt(`${s} news`, () => data.getMarketNews(s));
}
await attempt('market news', () => data.getMarketNews(undefined));

mkdirSync(PATHS.fixtures, { recursive: true });
writeFileSync(join(PATHS.fixtures, 'manifest.json'), JSON.stringify({
  recordedAt: new Date().toISOString(), symbols: [...symbols].sort(), intervals, ok, failed, failures
}, null, 2));
console.error(`fixtures: ${ok} ok, ${failed} failed (failures are recorded and replay as tool errors)`);
for (const f of failures) console.error(`  ${f}`);
