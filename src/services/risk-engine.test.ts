import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { getPortfolioRiskMetrics } from './risk-engine.js';

describe('Risk Engine Service', () => {
  it('should return risk metrics for a portfolio', () => {
    const portfolioReturns = [-0.01, 0.02, -0.03, 0.01, 0.05, -0.02, -0.04, 0.03, 0.01, 0.02];
    const metrics = getPortfolioRiskMetrics(portfolioReturns);
    
    assert.strictEqual(metrics.var95, -0.04);
    assert.strictEqual(metrics.var99, -0.04);
    assert.strictEqual(metrics.kellyRecommendation, 0);
  });

  it('should calculate Kelly with provided edge', () => {
    const metrics = getPortfolioRiskMetrics([0], 0.6, 1.5);
    assert.strictEqual(Math.abs(metrics.kellyRecommendation - 0.3333) < 0.001, true);
  });
});
