// src/services/primes/validation.ts
import { ATR } from 'technicalindicators';

/**
 * Results of a trade simulation including profit and cost metrics.
 */
export interface SimulationResult {
  /** Net profit in absolute currency units */
  netProfit: number;
  /** Net profit as a percentage of the entry capital */
  netProfitPercent: number;
  /** Total estimated slippage cost (both entry and exit) */
  slippageEstimate: number;
  /** Total fees incurred (both entry and exit) */
  fees: number;
}

/**
 * Simulates a trade and calculates performance metrics considering slippage and fees.
 * 
 * Slippage is estimated based on the Average True Range (ATR) of the asset.
 * 
 * @param entryPrice - The price at which the trade was theoretically entered
 * @param exitPrice - The price at which the trade was theoretically exited
 * @param volume - The number of units traded
 * @param highs - Historical high prices for ATR-based slippage calculation
 * @param lows - Historical low prices for ATR-based slippage calculation
 * @param closes - Historical close prices for ATR-based slippage calculation
 * @returns A SimulationResult object
 */
export function simulateTrade(
  entryPrice: number, 
  exitPrice: number, 
  volume: number,
  highs: number[],
  lows: number[],
  closes: number[]
): SimulationResult {
  const takerFee = 0.002; // 0.2%
  
  // ATR-based slippage estimation
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const latestATR = atr[atr.length - 1] || 0;
  const slippageFactor = entryPrice > 0 ? (latestATR / entryPrice) * 0.1 : 0; // Estimate 10% of ATR as slippage
  
  const slippagePerUnit = entryPrice * slippageFactor;
  const effectiveEntry = entryPrice + slippagePerUnit;
  const effectiveExit = exitPrice - slippagePerUnit;
  
  const grossProfit = (effectiveExit - effectiveEntry) * volume;
  const fees = (entryPrice * volume * takerFee) + (exitPrice * volume * takerFee);
  
  const netProfit = grossProfit - fees;
  const netProfitPercent = (entryPrice * volume) > 0 ? (netProfit / (entryPrice * volume)) * 100 : 0;
  
  return { netProfit, netProfitPercent, slippageEstimate: slippagePerUnit * 2, fees };
}
