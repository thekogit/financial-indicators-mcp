// src/evals/level1.ts
// Grades every trace file in evals/traces/ with the Level 1 assertions.
//   node dist/evals/level1.js          writes evals/results/level1_<model>.json
//   node dist/evals/level1.js --check  fails if a committed result no longer matches (CI gate)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertTrace, summarize } from './assertions.js';
import { loadQueries, loadTraces, parseArgs, PATHS } from './common.js';

const args = parseArgs(process.argv.slice(2));
const queries = new Map(loadQueries().map((q) => [q.id, q]));
const files = existsSync(PATHS.traces) ? readdirSync(PATHS.traces).filter((f) => f.endsWith('.jsonl')).sort() : [];
if (files.length === 0) {
  console.error('No trace files in evals/traces/. Run `npm run eval:run` first.');
  process.exit(args.check ? 0 : 1);
}

let stale = 0;
for (const file of files) {
  const traces = loadTraces(join(PATHS.traces, file));
  const results = traces.map((t) => {
    const q = queries.get(t.id);
    if (!q) throw new Error(`${file}: trace ${t.id} has no matching query`);
    return assertTrace(q, t);
  });
  const report = { traces_file: `evals/traces/${file}`, model: traces[0]?.model, summary: summarize(results), results };
  const target = join(PATHS.results, `level1_${basename(file, '.jsonl')}.json`);
  const text = JSON.stringify(report, null, 2) + '\n';
  if (args.check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) { stale++; console.error(`STALE: ${target} does not match a fresh grading of ${file}`); }
    else console.error(`ok: ${target}`);
  } else {
    mkdirSync(PATHS.results, { recursive: true });
    writeFileSync(target, text);
    const s = report.summary;
    console.error(`${file}: ${s.passed}/${s.traces} pass (${(s.pass_rate * 100).toFixed(1)}%), ${s.conflict_traces} traces with conflicting signals`);
    console.error(`  failures by code: ${JSON.stringify(s.by_code)}`);
  }
}
if (stale) process.exit(1);
