// src/evals/stub-data.ts
// Deterministic, network-free market data for tests.
import type { MarketDataDeps } from '../server.js';

export function syntheticRows(n: number, drift = 0.001) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: n }, (_, i) => {
    const close = 100 * Math.exp(drift * i + 0.02 * Math.sin(i / 3));
    return { date: new Date(start + i * 86_400_000), open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 + i };
  });
}

export const stubMarketData: MarketDataDeps = {
  getStockPrice: async (symbol) => {
    if (symbol === 'NOPE') throw new Error('Quote not found for symbol: NOPE');
    return { symbol, price: 101, change: 1, changePercent: 1, high: 102, low: 99, volume: 1000 };
  },
  getStockHistory: async (_s, _i, limit = 100) => syntheticRows(limit),
  getMarketNews: async () => [{ title: 'Shares rally on upgrade' }] as never,
  getCryptoPrice: async (symbol) => ({ symbol, price: 60000, change: 100, changePercent: 0.2, high: 61000, low: 59000, volume: 10 }),
  getCryptoHistory: async (_s, _i, limit = 100) => syntheticRows(limit, -0.002)
};
