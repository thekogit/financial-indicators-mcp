// src/evals/fixtures.ts
// Recorded market data for the benchmark. In `record` mode a missing fixture is fetched
// live once and saved (errors such as "symbol not found" are saved too, so they replay
// identically). In `replay` mode nothing touches the network.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketDataDeps } from '../server.js';

export type FixtureMode = 'record' | 'replay';

/** Bars recorded per interval; replay slices the most recent `limit` bars from these. */
export const RECORD_BARS: Record<string, number> = { '1m': 1000, '5m': 2000, '1h': 2000, '1d': 2000, '1wk': 1000, '1w': 1000 };
const CRYPTO_MAX_BARS = 1000;

type Saved<T> = { recordedAt: string; value?: T; error?: string };

/** Network-level failures are not recorded: they say nothing about the symbol. */
const TRANSIENT = /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket|429|Too Many|timed? ?out|503|502/i;

const fileKey = (parts: string[]) => {
  const readable = parts.join('__').replace(/[^A-Za-z0-9.^=-]+/g, '_').slice(0, 80);
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
  return `${readable}__${hash}.json`;
};

const cryptoPair = (symbol: string) => (symbol.includes('/') ? symbol : `${symbol}/USDT`);

export function fixtureMarketData(live: MarketDataDeps, dir: string, mode: FixtureMode): MarketDataDeps {
  async function cached<T>(kind: string, parts: string[], fetch: () => Promise<T>, revive: (v: T) => T = (v) => v): Promise<T> {
    const file = join(dir, kind, fileKey(parts));
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved<T>;
      if (saved.error !== undefined) throw new Error(saved.error);
      return revive(saved.value as T);
    }
    if (mode === 'replay') throw new Error(`No recorded market data for ${kind} ${parts.join(' ')}`);
    mkdirSync(join(dir, kind), { recursive: true });
    try {
      const value = await fetch();
      writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), value } satisfies Saved<T>));
      return revive(value);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!TRANSIENT.test(message)) {
        writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), error: message } satisfies Saved<T>));
      }
      throw e;
    }
  }

  const reviveRows = <R extends { date: Date | string }>(rows: R[]) => rows.map((r) => ({ ...r, date: new Date(r.date) }));

  return {
    getStockPrice: (symbol) => cached('stock-quote', [symbol], () => live.getStockPrice(symbol)),
    getMarketNews: (symbol) => cached('news', [symbol ?? '_market'], () => live.getMarketNews(symbol)),
    getCryptoPrice: (symbol) => cached('crypto-quote', [cryptoPair(symbol)], () => live.getCryptoPrice(symbol)),
    getStockHistory: async (symbol, interval = '1d', limit = 100) => {
      const bars = RECORD_BARS[interval] ?? 2000;
      const rows = await cached('stock-history', [symbol, String(interval)], () => live.getStockHistory(symbol, interval, bars), reviveRows);
      return rows.slice(-limit);
    },
    getCryptoHistory: async (symbol, interval = '1d', limit = 100) => {
      const pair = cryptoPair(symbol);
      const rows = await cached('crypto-history', [pair, interval], () => live.getCryptoHistory(pair, interval, CRYPTO_MAX_BARS), reviveRows);
      return rows.slice(-limit);
    }
  };
}
