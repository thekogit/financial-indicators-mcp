import assert from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, TOOL_INPUTS } from './server.js';
import { stubMarketData } from './evals/stub-data.js';

async function connect() {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const server = createServer(stubMarketData);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await server.connect(s);
  await client.connect(c);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

test('createServer registers every tool in TOOL_INPUTS', async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((t) => t.name).sort(), Object.keys(TOOL_INPUTS).sort());
  assert.strictEqual(tools.length, 11);
  await close();
});

test('tools read market data from the injected dependencies', async () => {
  const { client, close } = await connect();
  const price = JSON.parse(text(await client.callTool({ name: 'get-price', arguments: { symbol: 'AAPL' } })));
  assert.strictEqual(price.price, 101);
  const regime = JSON.parse(text(await client.callTool({ name: 'get-market-regime', arguments: { symbol: 'AAPL', limit: 100 } })));
  assert.ok(['Trending', 'Mean-Reverting', 'High-Volatility', 'Stable'].includes(regime.regime));
  const btc = JSON.parse(text(await client.callTool({ name: 'get-momentum-score', arguments: { symbol: 'BTC/USDT', limit: 50 } })));
  assert.ok(btc.momentumScore < 0, 'crypto stub drifts down');
  await close();
});

test('data errors come back as isError results, not exceptions', async () => {
  const { client, close } = await connect();
  const r = await client.callTool({ name: 'get-price', arguments: { symbol: 'NOPE' } });
  assert.strictEqual(r.isError, true);
  assert.match(text(r), /NOPE/);
  await close();
});
