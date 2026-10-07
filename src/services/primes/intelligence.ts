// src/services/primes/intelligence.ts
const POSITIVE_WORDS = new Set(['bullish', 'surge', 'growth', 'gain', 'approval', 'buy', 'rally', 'upgrade']);
const NEGATIVE_WORDS = new Set(['bearish', 'drop', 'crash', 'hack', 'rejection', 'sell', 'liquidated', 'dump', 'lawsuit']);

/**
 * Result of sentiment analysis on headlines.
 */
export interface SentimentResult {
  /** Aggregated sentiment score from -1 (very bearish) to 1 (very bullish) */
  score: number;
  /** Estimated speculation level based on keywords (0 to 1) */
  speculationIndex: number;
  /** Key qualitative insights derived from text analysis */
  insights: string[];
}

/**
 * Analyzes a set of headlines for market sentiment and speculation indicators.
 * 
 * @param headlines - Array of news headlines or social media strings
 * @returns A SentimentResult object with score, speculation index, and insights
 */
export function analyzeSentiment(headlines: string[]): SentimentResult {
  let totalScore = 0;
  let wordCount = 0;
  const insights: string[] = [];

  headlines.forEach(text => {
    const words = text.toLowerCase().split(/\W+/);
    words.forEach(word => {
      if (POSITIVE_WORDS.has(word)) totalScore += 1;
      if (NEGATIVE_WORDS.has(word)) totalScore -= 1;
      wordCount++;
    });
    
    if (text.toLowerCase().includes('retail') || text.toLowerCase().includes('reddit')) {
      insights.push('High retail speculation detected');
    }
  });

  const score = wordCount > 0 ? Math.max(-1, Math.min(1, totalScore / (headlines.length * 2))) : 0;
  const speculationIndex = Math.min(1, insights.length / 5); // Simple proxy

  return { score, speculationIndex, insights: [...new Set(insights)] };
}
