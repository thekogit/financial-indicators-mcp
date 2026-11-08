import assert from 'node:assert';
import { test } from 'node:test';
import { chooseThreshold, cohenKappa, confidenceBins, metrics, predict, splitOf, type Label } from './calibration.js';
import { parseVerdict } from './judge.js';

test("Cohen's kappa matches a hand-computed example", () => {
  // po = 0.7, pe = 0.5*0.6 + 0.5*0.4 = 0.5, kappa = 0.4
  assert.strictEqual(Number(cohenKappa({ tp: 20, fp: 5, fn: 10, tn: 15 })!.toFixed(10)), 0.4);
  assert.strictEqual(cohenKappa({ tp: 10, fp: 0, fn: 0, tn: 10 }), 1);
  assert.strictEqual(cohenKappa({ tp: 0, fp: 0, fn: 0, tn: 0 }), null);
});

test('precision and recall are on the FAIL class', () => {
  const gold: Label[] = ['FAIL', 'FAIL', 'PASS', 'PASS'];
  const m = metrics(gold, ['FAIL', 'PASS', 'FAIL', 'PASS']);
  assert.deepStrictEqual([m.tp, m.fp, m.fn, m.tn, m.precision, m.recall], [1, 1, 1, 1, 0.5, 0.5]);
  assert.strictEqual(metrics(['PASS'], ['PASS']).precision, null);
});

test('split is deterministic and close to 15 / 42.5 / 42.5', () => {
  const ids = Array.from({ length: 4000 }, (_, i) => `fim-${i}`);
  const counts = { train: 0, dev: 0, test: 0 };
  for (const id of ids) counts[splitOf(id)]++;
  assert.strictEqual(splitOf('fim-001'), splitOf('fim-001'));
  assert.ok(Math.abs(counts.train / 4000 - 0.15) < 0.02, JSON.stringify(counts));
  assert.ok(Math.abs(counts.dev / 4000 - 0.425) < 0.025, JSON.stringify(counts));
});

test('threshold selection separates perfectly separable scores', () => {
  const gold: Label[] = ['PASS', 'PASS', 'FAIL', 'FAIL'];
  const p = [0.1, 0.3, 0.7, 0.9];
  const t = chooseThreshold(gold, p);
  assert.deepStrictEqual(predict(p, t), gold);
});

test('confidence bins hold at most `size` items in score order', () => {
  const bins = confidenceBins([0.9, 0.1, 0.5, 0.3, 0.7].map((p_fail) => ({ p_fail })), 2);
  assert.deepStrictEqual(bins.map((b) => b.map((x) => x.p_fail)), [[0.1, 0.3], [0.5, 0.7], [0.9]]);
});

test('parseVerdict accepts JSON, clamps confidence and flags garbage', () => {
  assert.deepStrictEqual(parseVerdict('{"verdict":"fail","confidence":1.4,"reason":"r"}'), { verdict: 'FAIL', confidence: 1, reason: 'r' });
  assert.strictEqual(parseVerdict('Sure! {"verdict": "PASS", "confidence": 0.8}').verdict, 'PASS');
  assert.strictEqual(parseVerdict('PASS').verdict, 'INVALID');
});
