import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { calculateKellyFraction, calculateHistoricalVaR } from './risk-math.js';

describe('Risk Math Utilities', () => {
  it('should calculate Kelly Fraction correctly', () => {
    const fraction = calculateKellyFraction(0.55, 1.2);
    assert.strictEqual(Math.abs(fraction - 0.175) < 0.001, true);
  });

  it('should return 0 for negative edge', () => {
    const fraction = calculateKellyFraction(0.40, 1.0);
    assert.strictEqual(fraction, 0);
  });

  it('should return 0 if winLossRatio is <= 0', () => {
    const fraction = calculateKellyFraction(0.5, 0);
    assert.strictEqual(fraction, 0);
  });

  it('should throw error if winRate is out of range', () => {
    assert.throws(() => calculateKellyFraction(1.5, 1.0), /winRate must be between 0 and 1/);
  });
});

describe('Value at Risk (VaR)', () => {
  it('should calculate 95% historical VaR correctly', () => {
    // 100 returns. Sorted, the 5th percentile (index 4) represents the 95% confidence worst loss.
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000); // returns from -0.05 to +0.049
    // Sorted: -0.050, -0.049, -0.048, -0.047, -0.046... index 4 is -0.046
    const var95 = calculateHistoricalVaR(returns, 0.95);
    assert.strictEqual(Math.abs(var95 - (-0.046)) < 0.001, true);
  });
});
