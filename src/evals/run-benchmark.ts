// src/evals/run-benchmark.ts
// Runs the 200-query benchmark and writes one JSONL trace per query.
//   node dist/evals/run-benchmark.js [--model beam:cloud] [--offline] [--ids fim-001,fim-002]
//                                    [--limit 20] [--concurrency 4] [--out evals/traces/x.jsonl]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { liveMarketData } from '../server.js';
import { runQuery } from './agent.js';
import { loadEnv, loadQueries, mapLimit, parseArgs, PATHS, slug, toJsonl } from './common.js';
import { fixtureMarketData } from './fixtures.js';
import { LlmClient, llmConfigFromEnv } from './llm.js';

loadEnv();
const args = parseArgs(process.argv.slice(2));
const model = String(args.model || process.env.EVAL_AGENT_MODEL || process.env.LLM_MODEL || '');
if (!model) throw new Error('Set --model, EVAL_AGENT_MODEL or LLM_MODEL.');
const temperature = Number(args.temperature ?? 0);
const out = resolve(String(args.out ?? join(PATHS.traces, `${slug(model)}.jsonl`)));

let queries = loadQueries();
if (typeof args.ids === 'string') {
  const ids = new Set(args.ids.split(','));
  queries = queries.filter((q) => ids.has(q.id));
}
if (typeof args.limit === 'string') queries = queries.slice(0, Number(args.limit));

const manifest = join(PATHS.fixtures, 'manifest.json');
if (!existsSync(manifest)) throw new Error('No fixtures yet: run `npm run eval:fetch` first.');
const dataAsOf = (JSON.parse(readFileSync(manifest, 'utf8')).recordedAt as string).slice(0, 10);

const llm = new LlmClient(llmConfigFromEnv(PATHS.llmCache));
const marketData = fixtureMarketData(liveMarketData, PATHS.fixtures, args.offline ? 'replay' : 'record');

let done = 0;
const traces = await mapLimit(queries, Number(args.concurrency ?? 4), async (q) => {
  const t = await runQuery(q, { llm, model, temperature, marketData, dataAsOf });
  done++;
  console.error(`[${done}/${queries.length}] ${q.id} ${t.stop_reason} tools=${t.tool_calls.map((c) => c.name).join(',') || '-'}`);
  return t;
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toJsonl(traces));
console.error(`wrote ${traces.length} traces to ${out}`);
