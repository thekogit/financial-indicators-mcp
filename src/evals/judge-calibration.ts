// src/evals/judge-calibration.ts
// Measures the Level 2 judge against reference labels, separately for each kind of
// labeller: `human` labels (the protocol's target) and `ai_agent` labels (a model's
// reading of the same rubric, which is NOT a substitute for human agreement).
//   node dist/evals/judge-calibration.js --verdicts evals/results/judge_v1_beam_cloud.jsonl,evals/results/judge_v1_gemma4_31b.jsonl
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chooseThreshold, confidenceBins, metrics, predict, splitOf, type Label, type Split } from './calibration.js';
import { parseArgs, PATHS, readJsonl } from './common.js';
import type { JudgeVerdict } from './judge.js';

export type LabelerKind = 'human' | 'ai_agent';

export interface ReferenceLabel {
  /** Trace file (basename without .jsonl) the labelled trace comes from. */
  traces: string;
  id: string;
  label: Label;
  labeler: string;
  labeler_kind: LabelerKind;
  labeled_at: string;
  note?: string;
}

const FLOORS = { precision: 0.8, recall: 0.8, kappa: 0.7 };
const KINDS: LabelerKind[] = ['human', 'ai_agent'];

const args = parseArgs(process.argv.slice(2));
if (typeof args.verdicts !== 'string') throw new Error('--verdicts <judge_*.jsonl[,more.jsonl]> is required');
const verdictFiles = args.verdicts.split(',');
const verdicts = verdictFiles.flatMap((f) => readJsonl<JudgeVerdict>(resolve(f)));
const labels = existsSync(PATHS.labels) ? readJsonl<ReferenceLabel>(PATHS.labels) : [];
const key = (traces: string, id: string) => `${traces}#${id}`;

function calibrate(kind: LabelerKind) {
  const ofKind = labels.filter((l) => l.labeler_kind === kind);
  const gold = new Map(ofKind.map((l) => [key(l.traces, l.id), l.label]));
  // Split by query id, so one prompt never sits in train for one model and test for another.
  const rows = verdicts
    .filter((v) => v.verdict !== 'INVALID' && gold.has(key(v.traces, v.id)))
    .map((v) => ({ ...v, gold: gold.get(key(v.traces, v.id))!, split: splitOf(v.id) }));
  if (rows.length === 0) {
    return {
      status: 'pending',
      reason: kind === 'human'
        ? 'No human labels yet. A person labels traces with `npm run eval:label`.'
        : 'No AI-agent reference labels.'
    };
  }
  const of = (s: Split) => rows.filter((r) => r.split === s);
  const train = of('train');
  const threshold = train.length ? chooseThreshold(train.map((r) => r.gold), train.map((r) => r.p_fail)) : 0.5;
  const evalSplit = (s: Split) => {
    const r = of(s);
    return {
      ...metrics(r.map((x) => x.gold), predict(r.map((x) => x.p_fail), threshold)),
      pass_labels: r.filter((x) => x.gold === 'PASS').length,
      fail_labels: r.filter((x) => x.gold === 'FAIL').length
    };
  };
  const dev = evalSplit('dev');
  const test = evalSplit('test');
  const bins = confidenceBins([...of('dev'), ...of('test')]).map((b) => ({
    p_fail_range: [b[0].p_fail, b[b.length - 1].p_fail],
    n: b.length,
    agreement: Number((b.filter((x) => (x.p_fail >= threshold ? 'FAIL' : 'PASS') === x.gold).length / b.length).toFixed(4))
  }));
  const meets = (m: typeof dev) => (m.precision ?? 0) >= FLOORS.precision && (m.recall ?? 0) >= FLOORS.recall && (m.kappa ?? -1) > FLOORS.kappa;
  const warnings: string[] = [];
  if (dev.pass_labels < 30 || dev.fail_labels < 30) {
    warnings.push(`dev split has ${dev.pass_labels} PASS / ${dev.fail_labels} FAIL labels; the protocol asks for at least 30 of each`);
  }
  // Descriptive only: the judge's own verdicts against every label, no split, no tuning.
  const all_native_verdicts = metrics(rows.map((r) => r.gold), rows.map((r) => r.verdict as Label));
  return {
    status: 'measured',
    labeled_traces: rows.length,
    all_native_verdicts,
    labelers: [...new Set(ofKind.map((l) => l.labeler))],
    by_traces_file: Object.fromEntries([...new Set(rows.map((r) => r.traces))].map((t) => [t, rows.filter((r) => r.traces === t).length])),
    threshold_from_train: threshold,
    train_n: train.length,
    dev, test, bins_dev_test: bins,
    meets_floors: { dev: meets(dev), test: meets(test) },
    warnings
  };
}

const byKind = new Map(KINDS.map((k) => [k, calibrate(k)] as const));
const report = {
  verdicts_files: verdictFiles,
  labels_file: 'evals/labels/reference_labels.jsonl',
  floors: FLOORS,
  note: 'Only `human` measures judge-human agreement. `ai_agent` compares the judge with labels written by an AI coding agent and is not a substitute.',
  ...Object.fromEntries(byKind)
};
mkdirSync(PATHS.results, { recursive: true });
writeFileSync(join(PATHS.results, 'judge_calibration.json'), JSON.stringify(report, null, 2) + '\n');

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(3));
for (const [k, r] of byKind) {
  if (!('dev' in r) || !r.dev || !r.test) { console.error(`${k}: pending`); continue; }
  console.error(`${k}: n=${r.labeled_traces} threshold=${r.threshold_from_train} | dev P=${fmt(r.dev.precision)} R=${fmt(r.dev.recall)} kappa=${fmt(r.dev.kappa)} | test P=${fmt(r.test.precision)} R=${fmt(r.test.recall)} kappa=${fmt(r.test.kappa)}`);
  for (const w of r.warnings) console.error(`  warning: ${w}`);
}
