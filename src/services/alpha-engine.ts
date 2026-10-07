/**
 * Evaluates momentum score based on start-to-end price change.
 * 
 * @param prices - Array of historical prices
 * @returns A normalized score between -1 and 1
 */
export function momentumScore(prices: number[]): number {
  if (prices.length < 2) return 0;
  const start = prices[0];
  const end = prices[prices.length - 1];
  
  // Guard against division by zero
  if (start === 0) {
    return end > 0 ? 1 : (end < 0 ? -1 : 0);
  }
  
  const momentum = (end - start) / start;
  
  // Normalize signal between -1 and 1
  // A 10% move results in a full strength score (1.0 or -1.0)
  const strength = Math.max(-1, Math.min(1, momentum * 10)); 
  return strength;
}
