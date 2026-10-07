import assert from 'node:assert';
import { test } from 'node:test';
import { detectRegime } from './regime.js';
import { mulberry32 } from '../../utils/math.js';

test('detectRegime - Trending', () => {
  // Upward trend
  const prices = Array.from({ length: 128 }, (_, i) => 100 + i);
  const history = Array.from({ length: 256 }, (_, i) => 50 + i * 0.5);
  
  const result = detectRegime(prices, history);
  assert.ok(result.hurst > 0.5);
});

test('detectRegime - Mean-Reverting', () => {
  // Oscillating
  const prices = Array.from({ length: 128 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  const history = Array.from({ length: 256 }, (_, i) => 100 + (i % 4 === 0 ? 2 : -2));
  
  const result = detectRegime(prices, history);
  assert.ok(result.hurst < 0.5);
});

test('detectRegime - High-Volatility', () => {
  // High variance in current prices vs history
  const rand = mulberry32(1);
  const prices = Array.from({ length: 128 }, () => 100 + (rand() - 0.5) * 50);
  const history = Array.from({ length: 256 }, () => 100 + (rand() - 0.5) * 2);
  
  const result = detectRegime(prices, history);
  assert.strictEqual(result.regime, 'High-Volatility');
  assert.ok(result.volatilityPercentile > 0.8);
});
