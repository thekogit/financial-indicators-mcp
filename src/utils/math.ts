// src/utils/math.ts
import * as ss from 'simple-statistics';

/**
 * Calculates the logarithmic returns for a series of prices.
 * Log returns are additive and often preferred in quantitative finance for their statistical properties.
 * 
 * @param prices - An array of numerical price values.
 * @returns An array of log returns with length prices.length - 1.
 */
export function calculateLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

/**
 * Computes the Z-Score of a value relative to a numerical series.
 * The Z-Score indicates how many standard deviations a value is from the mean.
 * 
 * @param value - The specific value to score.
 * @param series - The reference series to calculate mean and standard deviation from.
 * @returns The Z-Score, or 0 if the series length is less than 2 or standard deviation is 0.
 */
export function calculateZScore(value: number, series: number[]): number {
  if (series.length < 2) return 0;
  const mean = ss.mean(series);
  const stdDev = ss.standardDeviation(series);
  return stdDev === 0 ? 0 : (value - mean) / stdDev;
}

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** Hurst exponent: slope of log(mean R/S) against log(window size), windows 8, 16, 32 ... */
export function calculateHurstExponent(prices: number[]): number {
  const returns = calculateLogReturns(prices);
  const n = returns.length;
  if (n < 32) return 0.5;
  const points: [number, number][] = [];
  for (let size = 8; size <= Math.floor(n / 2); size *= 2) {
    const rs: number[] = [];
    for (let start = 0; start + size <= n; start += size) {
      const chunk = returns.slice(start, start + size);
      const mean = ss.mean(chunk);
      let cum = 0, lo = Infinity, hi = -Infinity;
      for (const r of chunk) { cum += r - mean; lo = Math.min(lo, cum); hi = Math.max(hi, cum); }
      const sd = ss.standardDeviation(chunk);
      if (sd > 0) rs.push((hi - lo) / sd);
    }
    if (rs.length > 0) points.push([Math.log(size), Math.log(ss.mean(rs))]);
  }
  if (points.length < 2) return 0.5;
  return ss.linearRegression(points).m;
}

/** 5th and 95th percentile of the Hurst estimate on simulated random walks of the same length. */
export function randomWalkHurstBand(nPrices: number, sims = 200, seed = 42): { p5: number; p95: number } {
  const rand = mulberry32(seed);
  const hs: number[] = [];
  for (let k = 0; k < sims; k++) {
    let p = 100;
    const prices = [p];
    for (let i = 1; i < nPrices; i++) { p *= Math.exp(0.01 * gaussian(rand)); prices.push(p); }
    hs.push(calculateHurstExponent(prices));
  }
  return { p5: ss.quantile(hs, 0.05), p95: ss.quantile(hs, 0.95) };
}

/**
 * Calculates the Pearson Correlation Coefficient between two numerical series.
 * Measures the linear correlation between series A and series B.
 * 
 * @param seriesA - The first numerical series.
 * @param seriesB - The second numerical series.
 * @returns The correlation coefficient ranging from -1 to 1, or 0 if lengths mismatch or series are too short.
 */
export function calculatePearsonCorrelation(seriesA: number[], seriesB: number[]): number {
  if (seriesA.length !== seriesB.length || seriesA.length < 2) return 0;
  return ss.sampleCorrelation(seriesA, seriesB);
}
