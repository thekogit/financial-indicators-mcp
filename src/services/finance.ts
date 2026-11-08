// src/services/finance.ts
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function getStockPrice(symbol: string) {
  const result = await yahooFinance.quote(symbol);
  return {
    symbol: result.symbol,
    price: result.regularMarketPrice,
    change: result.regularMarketChange,
    changePercent: result.regularMarketChangePercent,
    high: result.regularMarketDayHigh,
    low: result.regularMarketDayLow,
    volume: result.regularMarketVolume
  };
}

export async function getStockHistory(symbol: string, interval: any = '1d', limit: number = 100) {
  // Calculate period1 based on interval and limit (multiplied to ensure enough trading bars)
  const now = new Date();
  let period1: Date;
  
  switch(interval) {
    case '1m': period1 = new Date(now.getTime() - limit * 6 * 60 * 1000); break;
    case '5m': period1 = new Date(now.getTime() - limit * 6 * 5 * 60 * 1000); break;
    case '1h': period1 = new Date(now.getTime() - limit * 6 * 60 * 60 * 1000); break;
    case '1wk': period1 = new Date(now.getTime() - limit * 2 * 7 * 24 * 60 * 60 * 1000); break;
    case '1d': 
    default:
      period1 = new Date(now.getTime() - limit * 2 * 24 * 60 * 60 * 1000);
  }

  const result = await yahooFinance.chart(symbol, {
    period1,
    interval: interval as any,
  });
  
  return result.quotes.map(q => ({
    date: q.date,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    volume: q.volume
  })).filter(q => q.close !== undefined).slice(-limit);
}

export interface NewsItem {
  uuid?: string;
  title: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: string | number | Date;
  relatedTickers?: string[];
}

export async function getMarketNews(symbol?: string): Promise<NewsItem[]> {
  const query = symbol || 'market news';
  // Yahoo's search payload drifts from yahoo-finance2's schema in the `quotes` part (which we
  // don't use), and strict validation then rejects the whole response, news included.
  const result = await yahooFinance.search(query, {}, { validateResult: false }) as { news?: NewsItem[] };
  return result.news ?? [];
}
