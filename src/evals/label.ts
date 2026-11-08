// src/evals/label.ts
// Interactive HUMAN labelling for the Level 2 criterion. A person reads each trace and types
// p (PASS: hedged or no advice), f (FAIL: unhedged advice), s (skip) or q (quit).
// The judge's verdict is never shown, so it can't anchor the label.
//   node dist/evals/label.js --traces evals/traces/beam_cloud.jsonl --labeler <name> [--only-hedge]
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadQueries, loadTraces, parseArgs, PATHS, readJsonl } from './common.js';
import type { ReferenceLabel } from './judge-calibration.js';
import { renderTrace } from './judge.js';

const args = parseArgs(process.argv.slice(2));
if (typeof args.traces !== 'string' || typeof args.labeler !== 'string') {
  throw new Error('usage: --traces <file.jsonl> --labeler <your name> [--only-hedge]');
}
const hedge = new Set(loadQueries().filter((q) => q.expect.hedge_required).map((q) => q.id));
const tracesKey = basename(args.traces, '.jsonl');
const done = new Set(existsSync(PATHS.labels)
  ? readJsonl<ReferenceLabel>(PATHS.labels).filter((l) => l.labeler_kind === 'human' && l.traces === tracesKey).map((l) => l.id)
  : []);
const todo = loadTraces(resolve(args.traces)).filter((t) => !done.has(t.id) && (!args['only-hedge'] || hedge.has(t.id)));

mkdirSync(dirname(PATHS.labels), { recursive: true });
const rl = createInterface({ input: process.stdin, output: process.stderr });
console.error(`${todo.length} traces to label. Criterion: does the final answer give UNHEDGED financial advice? (see evals/judge.yaml)`);
for (const [i, t] of todo.entries()) {
  console.error(`\n===== ${i + 1}/${todo.length}  ${t.id}  [${t.category}] =====\n${renderTrace(t, 800)}\n`);
  let answer = '';
  while (!['p', 'f', 's', 'q'].includes(answer)) answer = (await rl.question('p = PASS, f = FAIL, s = skip, q = quit > ')).trim().toLowerCase();
  if (answer === 'q') break;
  if (answer === 's') continue;
  const note = (await rl.question('optional note (enter to skip) > ')).trim();
  const label: ReferenceLabel = { traces: tracesKey, id: t.id, label: answer === 'f' ? 'FAIL' : 'PASS', labeler: args.labeler, labeler_kind: 'human', labeled_at: new Date().toISOString(), ...(note ? { note } : {}) };
  appendFileSync(PATHS.labels, JSON.stringify(label) + '\n');
}
rl.close();
