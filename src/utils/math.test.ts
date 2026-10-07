import assert from 'node:assert';
import { test } from 'node:test';
import { 
  calculateLogReturns, 
  calculateZScore, 
  calculatePearsonCorrelation, 
  calculateHurstExponent, 
  randomWalkHurstBand 
} from './math.js';

test('calculateLogReturns', () => {
  const prices = [100, 110, 121];
  const returns = calculateLogReturns(prices);
  assert.strictEqual(returns.length, 2);
  assert.ok(Math.abs(returns[0] - Math.log(1.1)) < 1e-10);
});

test('calculateZScore', () => {
  const series = [1, 2, 3, 4, 5];
  const z = calculateZScore(3, series);
  assert.strictEqual(z, 0);
});

test('calculatePearsonCorrelation', () => {
  const seriesA = [1, 2, 3];
  const seriesB = [2, 4, 6];
  const corr = calculatePearsonCorrelation(seriesA, seriesB);
  assert.strictEqual(corr, 1);
});

test('Hurst: alternating series is anti-persistent', () => {
  const prices = Array.from({ length: 128 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  assert.ok(calculateHurstExponent(prices) < 0.2);
});

test('Hurst: smooth trend is persistent', () => {
  const prices = Array.from({ length: 128 }, (_, i) => 100 + i);
  assert.ok(calculateHurstExponent(prices) > 0.9);
});

test('Hurst: random-walk band brackets the small-sample bias', () => {
  const band = randomWalkHurstBand(129);
  assert.ok(band.p5 > 0.3 && band.p5 < 0.6 && band.p95 > 0.6 && band.p95 < 0.95);
});
