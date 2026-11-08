import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixtureMarketData } from './fixtures.js';
import { stubMarketData } from './stub-data.js';

test('record once, then replay offline with the same data and the same errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fim-fixtures-'));
  try {
    let liveCalls = 0;
    const counting = { ...stubMarketData, getStockHistory: async (s: string, i: string, l?: number) => { liveCalls++; return stubMarketData.getStockHistory(s, i, l); } };
    const rec = fixtureMarketData(counting, dir, 'record');
    const a = await rec.getStockHistory('AAPL', '1d', 50);
    const b = await rec.getStockHistory('AAPL', '1d', 120);
    assert.strictEqual(liveCalls, 1, 'second call is served from the fixture');
    assert.strictEqual(a.length, 50);
    assert.strictEqual(b.length, 120);
    assert.ok(b[0].date instanceof Date, 'dates are revived');
    await assert.rejects(rec.getStockPrice('NOPE'), /NOPE/);

    const replay = fixtureMarketData(stubMarketData, dir, 'replay');
    assert.deepStrictEqual(await replay.getStockHistory('AAPL', '1d', 50), a);
    await assert.rejects(replay.getStockPrice('NOPE'), /NOPE/, 'recorded error replays');
    await assert.rejects(replay.getStockPrice('MSFT'), /No recorded market data/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
