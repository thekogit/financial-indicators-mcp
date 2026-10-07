// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getStockPrice, getStockHistory, getMarketNews } from './services/finance.js';
import { getCryptoPrice, getCryptoHistory } from './services/crypto.js';
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

const server = new McpServer({
  name: 'financial-indicators',
  version: '1.0.0'
});

server.tool('get-price', 'Get current price for a stock or crypto symbol', {
  symbol: z.string().describe('Ticker symbol (e.g. AAPL, BTC/USDT)')
}, async ({ symbol }) => {
  try {
    const data = isCrypto(symbol) ? await getCryptoPrice(symbol) : await getStockPrice(symbol);
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

server.tool('get-indicators', 'Calculate technical indicators (RSI, MACD, Bollinger Bands) and market regime', {
  symbol: z.string().describe('Ticker symbol'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().default(100).describe('Number of data points to return')
}, async ({ symbol, interval, limit }) => {
  try {
    const cryptoInterval = interval === '1wk' ? '1w' : interval;
    const history = isCrypto(symbol) 
      ? await getCryptoHistory(symbol, cryptoInterval, limit * 2) 
      : await getStockHistory(symbol, interval, limit * 2);
    
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

server.tool('plot-indicators', 'Generate a PNG plot of price action and technical indicators', {
  symbol: z.string().describe('Ticker symbol'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().default(100).describe('Number of periods to plot')
}, async ({ symbol, interval, limit }) => {
  try {
    const fetchLimit = limit + 50;
    const cryptoInterval = interval === '1wk' ? '1w' : interval;
    const history = isCrypto(symbol)
      ? await getCryptoHistory(symbol, cryptoInterval, fetchLimit)
      : await getStockHistory(symbol, interval, fetchLimit);

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

server.tool('get-market-news', 'Fetch latest market news, optionally filtered by symbol', {
  symbol: z.string().optional().describe('Ticker symbol for specific news')
}, async ({ symbol }) => {
  try {
    const news = await getMarketNews(symbol);
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

server.tool('get-market-regime', 'Classify the regime as Trending, Mean-Reverting, High-Volatility or Stable from a multi-window Hurst estimate (compared with simulated random walks) and the current volatility percentile.', {
  symbol: z.string().describe('Ticker symbol'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().default(100).describe('Number of data points to analyze')
}, async ({ symbol, interval, limit }) => {
  try {
    const cryptoInterval = interval === '1wk' ? '1w' : interval;
    const history = isCrypto(symbol) 
      ? await getCryptoHistory(symbol, cryptoInterval, limit * 2) 
      : await getStockHistory(symbol, interval, limit * 2);
    
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

server.tool('get-engineered-features', 'Return log returns, the 20-bar z-score, Bollinger %B and the % distance from the 20-bar mean.', {
  symbol: z.string().describe('Ticker symbol'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().default(100).describe('Number of data points')
}, async ({ symbol, interval, limit }) => {
  try {
    const cryptoInterval = interval === '1wk' ? '1w' : interval;
    const history = isCrypto(symbol) 
      ? await getCryptoHistory(symbol, cryptoInterval, limit) 
      : await getStockHistory(symbol, interval, limit);
    
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

server.tool('get-headline-keyword-score', 'Score recent Yahoo Finance headlines with a small keyword list from −1 (bearish) to 1 (bullish). A rough heuristic, not a language model. The raw headlines are returned too.', {
  symbol: z.string().optional().describe('Ticker symbol for specific news')
}, async ({ symbol }) => {
  try {
    const news = await getMarketNews(symbol);
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

server.tool('simulate-trade', 'Net P&L of one long trade after a 0.2% taker fee per side and slippage of 10% of the 14-day ATR.', {
  symbol: z.string().describe('Ticker symbol'),
  entryPrice: z.number().positive().describe('Price at trade entry'),
  exitPrice: z.number().describe('Price at trade exit'),
  volume: z.number().positive().default(1).describe('Quantity of asset')
}, async ({ symbol, entryPrice, exitPrice, volume }) => {
  try {
    const history = isCrypto(symbol) 
      ? await getCryptoHistory(symbol, '1d', 30) 
      : await getStockHistory(symbol, '1d', 30);
    
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

server.tool('get-correlation-matrix', 'Pearson correlation of log returns between a base symbol and each benchmark, aligned by date. null = not enough overlapping data.', {
  symbol: z.string().describe('Base ticker symbol (e.g. AAPL)'),
  benchmarks: z.array(z.string()).describe('List of symbols to correlate with (e.g. ["BTC/USDT", "SPY"])'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().default(100).describe('Correlation window size')
}, async ({ symbol, benchmarks, interval, limit }) => {
  try {
    const fetchHistory = async (s: string) => {
      const cryptoInterval = interval === '1wk' ? '1w' : interval;
      return isCrypto(s) 
        ? await getCryptoHistory(s, cryptoInterval, limit) 
        : await getStockHistory(s, interval, limit);
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

server.tool('get-portfolio-risk-metrics', 'Historical VaR at 95% and 99% (the 5th and 1st percentile of the returns you pass; negative = loss) and the Kelly fraction for your win rate and win/loss ratio.', {
  returns: z.array(z.number()).describe('Array of historical portfolio returns'),
  winRate: z.number().min(0).max(1).default(0.5).describe('Historical win rate (0-1)'),
  winLossRatio: z.number().min(0).default(1.0).describe('Historical win/loss ratio')
}, async ({ returns, winRate, winLossRatio }) => {
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

server.tool('get-momentum-score', 'Momentum score from −1 to 1: the % change over the window × 10, capped. A 10% move gives ±1.', {
  symbol: z.string().describe('Ticker symbol'),
  interval: z.enum(['1m', '5m', '1h', '1d', '1wk']).default('1d').describe('Time interval'),
  limit: z.number().min(2).default(100).describe('Signal calculation window')
}, async ({ symbol, interval, limit }) => {
  try {
    // Normalize interval for crypto
    const cryptoInterval = interval === '1wk' ? '1w' : interval;
    const history = isCrypto(symbol) 
      ? await getCryptoHistory(symbol, cryptoInterval, limit * 2) 
      : await getStockHistory(symbol, interval, limit * 2);
    
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Financial Indicators MCP Server running...');
