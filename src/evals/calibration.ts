// src/evals/calibration.ts
// Pure maths for calibrating the Level 2 judge against human labels: a deterministic
// train/dev/test split, precision/recall on the FAIL class, Cohen's kappa, and threshold
// selection on the train split only.
import { createHash } from 'node:crypto';

export type Label = 'PASS' | 'FAIL';
export type Split = 'train' | 'dev' | 'test';

/** 15% train, 42.5% dev, 42.5% test, decided by a hash of the trace id so it never shifts. */
export function splitOf(id: string, seed = 'fim-judge-v1'): Split {
  const h = createHash('sha256').update(`${seed}:${id}`).digest().readUInt32BE(0) / 2 ** 32;
  return h < 0.15 ? 'train' : h < 0.575 ? 'dev' : 'test';
}

export interface Confusion { tp: number; fp: number; fn: number; tn: number }

export function confusion(gold: Label[], pred: Label[]): Confusion {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  gold.forEach((g, i) => {
    const p = pred[i];
    if (p === 'FAIL' && g === 'FAIL') c.tp++;
    else if (p === 'FAIL') c.fp++;
    else if (g === 'FAIL') c.fn++;
    else c.tn++;
  });
  return c;
}

export interface Metrics extends Confusion {
  n: number;
  precision: number | null;
  recall: number | null;
  kappa: number | null;
}

export function metrics(gold: Label[], pred: Label[]): Metrics {
  const c = confusion(gold, pred);
  const n = gold.length;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  return { ...c, n, precision, recall, kappa: cohenKappa(c) };
}

export function cohenKappa(c: Confusion): number | null {
  const n = c.tp + c.fp + c.fn + c.tn;
  if (n === 0) return null;
  const po = (c.tp + c.tn) / n;
  const pYes = ((c.tp + c.fp) / n) * ((c.tp + c.fn) / n);
  const pNo = ((c.fn + c.tn) / n) * ((c.fp + c.tn) / n);
  const pe = pYes + pNo;
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

/** Predict FAIL when p_fail >= threshold. */
export const predict = (pFail: number[], threshold: number): Label[] => pFail.map((p) => (p >= threshold ? 'FAIL' : 'PASS'));

/**
 * Picks the threshold that maximises min(precision, recall) on the given (train) items,
 * breaking ties toward 0.5. Candidates are the distinct scores plus 0.5.
 */
export function chooseThreshold(gold: Label[], pFail: number[]): number {
  const candidates = [...new Set([0.5, ...pFail])].sort((a, b) => a - b);
  let best = 0.5, bestScore = -1;
  for (const t of candidates) {
    const m = metrics(gold, predict(pFail, t));
    const score = Math.min(m.precision ?? 0, m.recall ?? 0);
    if (score > bestScore || (score === bestScore && Math.abs(t - 0.5) < Math.abs(best - 0.5))) { best = t; bestScore = score; }
  }
  return best;
}

/** Groups items into bins of `size` by ascending judge score, for per-bin agreement. */
export function confidenceBins<T extends { p_fail: number }>(items: T[], size = 20): T[][] {
  const sorted = [...items].sort((a, b) => a.p_fail - b.p_fail);
  const bins: T[][] = [];
  for (let i = 0; i < sorted.length; i += size) bins.push(sorted.slice(i, i + size));
  return bins;
}
