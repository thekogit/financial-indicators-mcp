import { describe, it } from 'node:test';
import assert from 'node:assert';
import { momentumScore } from './alpha-engine.js';

describe('Alpha Engine Service', () => {
  it('should evaluate momentum score', () => {
    const prices = [100, 101, 102, 105, 110];
    const signal = momentumScore(prices);
    assert.strictEqual(signal > 0, true);
  });

  it('should return 0 for zero momentum', () => {
    const prices = [100, 100, 100];
    const signal = momentumScore(prices);
    assert.strictEqual(signal, 0);
  });

  it('should handle zero starting price safely', () => {
    const signal = momentumScore([0, 10]);
    assert.strictEqual(signal, 1);
  });

  it('should handle empty or small arrays', () => {
    assert.strictEqual(momentumScore([]), 0);
    assert.strictEqual(momentumScore([100]), 0);
  });

  it('should clamp large momentum', () => {
    const signal = momentumScore([10, 100]); // 900% gain
    assert.strictEqual(signal, 1);
  });
});
