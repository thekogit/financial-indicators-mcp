// src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as finance from './services/finance.js';
import * as crypto from './services/crypto.js';
import { isCrypto } from './utils/helpers.js';
import { calculateRSI, calculateMACD, calculateBB } from './services/ta-engine.js';
import { calculatePearsonCorrelation, calculateLogReturns } from './utils/math.js';
import { generatePlot } from './services/plotter.js';
import { detectRegime } from './services/primes/regime.js';
import { engineerFeatures } from './services/primes/features.js';
import { analyzeSentiment } from './services/primes/intelligence.js';
import { simulateTrade } from './services/primes/validation.js';
import { getPortfolioRiskMetrics } from './services/risk-engine.js';
import { momentumScore } from './services/alpha-engine.js';

/**
 * The market-data functions the tools depend on. The live implementation calls
 * Yahoo Finance and Binance; the eval harness swaps in recorded fixtures.
 */
export interface MarketDataDeps {
  getStockPrice: typeof finance.getStockPrice;
  getStockHistory: typeof finance.getStockHistory;
  getMarketNews: typeof finance.getMarketNews;
  getCryptoPrice: typeof crypto.getCryptoPrice;
  getCryptoHistory: typeof crypto.getCryptoHistory;
}

export const liveMarketData: MarketDataDeps = {
  getStockPrice: finance.getStockPrice,
  getStockHistory: finance.getStockHistory,
  getMarketNews: finance.getMarketNews,
  getCryptoPrice: crypto.getCryptoPrice,
  getCryptoHistory: crypto.getCryptoHistory
};

/** Input schema of every tool, shared by the server and the eval assertions. */
export const TOOL_INPUTS = {
  'get-price': {
    symbol: z.string().describe('Ticker symbol (e.g. AAPL, BTC/USDT)')
  },
  'get-indicators': {
    symbol: z.string().describe('Ticker symbol'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().default(100).describe('Number of data points to return')
  },
  'plot-indicators': {
    symbol: z.string().describe('Ticker symbol'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().default(100).describe('Number of periods to plot')
  },
  'get-market-news': {
    symbol: z.string().optional().describe('Ticker symbol for specific news')
  },
  'get-market-regime': {
    symbol: z.string().describe('Ticker symbol'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().default(100).describe('Number of data points to analyze')
  },
  'get-engineered-features': {
    symbol: z.string().describe('Ticker symbol'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().default(100).describe('Number of data points')
  },
  'get-headline-keyword-score': {
    symbol: z.string().optional().describe('Ticker symbol for specific news')
  },
  'simulate-trade': {
    symbol: z.string().describe('Ticker symbol'),
    entryPrice: z.number().positive().describe('Price at trade entry'),
    exitPrice: z.number().describe('Price at trade exit'),
    volume: z.number().positive().default(1).describe('Quantity of asset')
  },
  'get-correlation-matrix': {
    symbol: z.string().describe('Base ticker symbol (e.g. AAPL)'),
    benchmarks: z.array(z.string()).describe('List of symbols to correlate with (e.g. ["BTC/USDT", "SPY"])'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().default(100).describe('Correlation window size')
  },
  'get-portfolio-risk-metrics': {
    returns: z.array(z.number()).describe('Array of historical portfolio returns'),
    winRate: z.number().min(0).max(1).default(0.5).describe('Historical win rate (0-1)'),
    winLossRatio: z.number().min(0).default(1.0).describe('Historical win/loss ratio')
  },
  'get-momentum-score': {
    symbol: z.string().describe('Ticker symbol'),
    interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
    limit: z.number().min(2).default(100).describe('Signal calculation window')
  }
} satisfies Record<string, z.ZodRawShape>;

export type ToolName = keyof typeof TOOL_INPUTS;

export function createServer(deps: MarketDataDeps = liveMarketData): McpServer {
  const server = new McpServer({
    name: 'financial-indicators',
    version: '1.0.0'
  });

  server.tool('get-price', 'Fetch latest quote (price, day change, % change, day high/low, volume) from Yahoo Finance for equities or Binance via CCXT for crypto pairs.', TOOL_INPUTS['get-price'], async ({ symbol }) => {
    try {
      const data = isCrypto(symbol) ? await deps.getCryptoPrice(symbol) : await deps.getStockPrice(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error fetching price for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-indicators', 'Compute 14-period RSI, MACD (12, 26, 9), 20-period Bollinger Bands (±2σ), and statistical regime confidence matrix over close prices.', TOOL_INPUTS['get-indicators'], async ({ symbol, interval, limit }) => {
    try {
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      const history = isCrypto(symbol) 
        ? await deps.getCryptoHistory(symbol, cryptoInterval, limit * 2) 
        : await deps.getStockHistory(symbol, interval, limit * 2);
    
      const allPrices = history.map((h: any) => h.close as number);
      const prices = allPrices.slice(-limit);
    
      const rsi = calculateRSI(allPrices).slice(-limit);
      const macd = calculateMACD(allPrices).slice(-limit);
      const bb = calculateBB(allPrices).slice(-limit);
    
      // Get market regime for confidence matrix
      const { confidenceMatrix } = detectRegime(prices, allPrices);

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({
            symbol,
            interval,
            rsi,
            macd,
            bb,
            confidenceMatrix,
            historyCount: history.length
          }, null, 2) 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error calculating indicators for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('plot-indicators', 'Generate a 3-panel PNG chart showing price with 20-period Bollinger Bands, 14-period RSI, and MACD lines, annotated with detected market regime.', TOOL_INPUTS['plot-indicators'], async ({ symbol, interval, limit }) => {
    try {
      const fetchLimit = limit + 50;
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      const history = isCrypto(symbol)
        ? await deps.getCryptoHistory(symbol, cryptoInterval, fetchLimit)
        : await deps.getStockHistory(symbol, interval, fetchLimit);

      const prices = history.map((h: any) => h.close as number);
      const rsi = calculateRSI(prices);
      const macd = calculateMACD(prices);
      const bb = calculateBB(prices);

      const { regime } = detectRegime(prices.slice(-limit), prices);

      const plotBuffer = await generatePlot({
        symbol,
        prices: prices.slice(-limit),
        rsi: rsi.slice(-limit),
        macd: macd.slice(-limit),
        bb: bb.slice(-limit),
        regime: regime
      });

      return {
        content: [
          { type: 'text', text: `Successfully generated plot for ${symbol} (${interval})` },
          { type: 'image', data: plotBuffer.toString('base64'), mimeType: 'image/png' }
        ]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error generating plot for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-market-news', 'Fetch recent news articles (title, publisher, link, publish time) from Yahoo Finance search, optionally filtered by symbol.', TOOL_INPUTS['get-market-news'], async ({ symbol }) => {
    try {
      const news = await deps.getMarketNews(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(news, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error fetching news: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-market-regime', 'Classify the regime as Trending, Mean-Reverting, High-Volatility or Stable from a multi-window Hurst estimate (compared with simulated random walks) and the current volatility percentile.', TOOL_INPUTS['get-market-regime'], async ({ symbol, interval, limit }) => {
    try {
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      const history = isCrypto(symbol) 
        ? await deps.getCryptoHistory(symbol, cryptoInterval, limit * 2) 
        : await deps.getStockHistory(symbol, interval, limit * 2);
    
      const prices = history.map((h: any) => h.close as number);
      const result = detectRegime(prices.slice(-limit), prices);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error detecting regime for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-engineered-features', 'Return log returns, the 20-bar z-score, Bollinger %B and the % distance from the 20-bar mean.', TOOL_INPUTS['get-engineered-features'], async ({ symbol, interval, limit }) => {
    try {
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      const history = isCrypto(symbol) 
        ? await deps.getCryptoHistory(symbol, cryptoInterval, limit) 
        : await deps.getStockHistory(symbol, interval, limit);
    
      const prices = history.map((h: any) => h.close as number);
      const result = engineerFeatures(prices);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error engineering features for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-headline-keyword-score', 'Score recent Yahoo Finance headlines with a small keyword list from −1 (bearish) to 1 (bullish). A rough heuristic, not a language model. The raw headlines are returned too.', TOOL_INPUTS['get-headline-keyword-score'], async ({ symbol }) => {
    try {
      const news = await deps.getMarketNews(symbol);
      const headlines = news.map((n: any) => n.headline || n.title || '');
      const result = analyzeSentiment(headlines);

      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, headlines }, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error analyzing sentiment: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('simulate-trade', 'Net P&L of one long trade after a 0.2% taker fee per side and slippage of 10% of the 14-day ATR.', TOOL_INPUTS['simulate-trade'], async ({ symbol, entryPrice, exitPrice, volume }) => {
    try {
      const history = isCrypto(symbol) 
        ? await deps.getCryptoHistory(symbol, '1d', 30) 
        : await deps.getStockHistory(symbol, '1d', 30);
    
      const highs = history.map((h: any) => h.high as number);
      const lows = history.map((h: any) => h.low as number);
      const closes = history.map((h: any) => h.close as number);

      const result = simulateTrade(entryPrice, exitPrice, volume, highs, lows, closes);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error simulating trade for ${symbol}: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-correlation-matrix', 'Pearson correlation of log returns between a base symbol and each benchmark, aligned by date. null = not enough overlapping data.', TOOL_INPUTS['get-correlation-matrix'], async ({ symbol, benchmarks, interval, limit }) => {
    try {
      const fetchHistory = async (s: string) => {
        const cryptoInterval = interval === '1wk' ? '1w' : interval;
        return isCrypto(s) 
          ? await deps.getCryptoHistory(s, cryptoInterval, limit) 
          : await deps.getStockHistory(s, interval, limit);
      };

      const baseHistory = await fetchHistory(symbol);

      const results: Record<string, number | null> = {};
      results[symbol] = 1.0;

      for (const b of benchmarks) {
        try {
          const bHistory = await fetchHistory(b);
          const key = (q: any) => {
            const iso = new Date(q.date).toISOString();
            return interval === '1d' || interval === '1wk' ? iso.slice(0, 10) : iso;
          };
          const baseMap = new Map(baseHistory.map((q: any) => [key(q), q.close as number]));
          const bMap = new Map(bHistory.map((q: any) => [key(q), q.close as number]));
          const dates = [...baseMap.keys()].filter((d) => bMap.has(d)).sort();
          if (dates.length < 21) { results[b] = null; continue; }
          const ra = calculateLogReturns(dates.map((d) => baseMap.get(d)!));
          const rb = calculateLogReturns(dates.map((d) => bMap.get(d)!));
          results[b] = calculatePearsonCorrelation(ra, rb);
        } catch (e) {
          results[b] = null;
        }
      }

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({
            base: symbol,
            correlations: results,
            window: limit,
            interval
          }, null, 2) 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error calculating correlations: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-portfolio-risk-metrics', 'Historical VaR at 95% and 99% (the 5th and 1st percentile of the returns you pass; negative = loss) and the Kelly fraction for your win rate and win/loss ratio.', TOOL_INPUTS['get-portfolio-risk-metrics'], async ({ returns, winRate, winLossRatio }) => {
    try {
      const metrics = getPortfolioRiskMetrics(returns, winRate, winLossRatio);
      return {
        content: [{ type: 'text', text: JSON.stringify(metrics, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error calculating risk metrics: ${error.message}` }],
        isError: true
      };
    }
  });

  server.tool('get-momentum-score', 'Momentum score from −1 to 1: the % change over the window × 10, capped. A 10% move gives ±1.', TOOL_INPUTS['get-momentum-score'], async ({ symbol, interval, limit }) => {
    try {
      // Normalize interval for crypto
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      const history = isCrypto(symbol) 
        ? await deps.getCryptoHistory(symbol, cryptoInterval, limit * 2) 
        : await deps.getStockHistory(symbol, interval, limit * 2);
    
      const allPrices = history.map((h: any) => h.close as number);
      const prices = allPrices.slice(-limit);
      const signal = momentumScore(prices);

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({ symbol, momentumScore: signal, type: 'momentum' }, null, 2) 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error generating momentum score: ${error.message}` }],
        isError: true
      };
    }
  });

  return server;
}
