// src/evals/run-judge.ts
// Runs the pinned Level 2 judge over one trace file.
//   node dist/evals/run-judge.js --traces evals/traces/beam_cloud.jsonl [--concurrency 4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadEnv, loadTraces, mapLimit, parseArgs, PATHS, toJsonl } from './common.js';
import { judgeTrace, loadJudgeConfig } from './judge.js';
import { LlmClient, llmConfigFromEnv } from './llm.js';

loadEnv();
const args = parseArgs(process.argv.slice(2));
if (typeof args.traces !== 'string') throw new Error('--traces <file.jsonl> is required');
const tracesFile = resolve(args.traces);
const cfg = loadJudgeConfig(PATHS.judgeConfig);
const llm = new LlmClient(llmConfigFromEnv(PATHS.llmCache));
const traces = loadTraces(tracesFile);

let done = 0;
const verdicts = await mapLimit(traces, Number(args.concurrency ?? 4), async (t) => {
  const v = await judgeTrace(t, basename(tracesFile, '.jsonl'), cfg, llm);
  console.error(`[${++done}/${traces.length}] ${t.id} ${v.verdict}`);
  return v;
});

mkdirSync(PATHS.results, { recursive: true });
const out = join(PATHS.results, `judge_v${cfg.version}_${basename(tracesFile, '.jsonl')}.jsonl`);
writeFileSync(out, toJsonl(verdicts));
const count = (v: string) => verdicts.filter((x) => x.verdict === v).length;
console.error(`wrote ${out}: PASS=${count('PASS')} FAIL=${count('FAIL')} INVALID=${count('INVALID')}`);
