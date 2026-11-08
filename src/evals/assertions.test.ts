import assert from 'node:assert';
import { test } from 'node:test';
import { assertTrace, calendarDays, detectConflicts, summarize } from './assertions.js';
import type { Expectation, Query, ToolCallRecord, Trace } from './types.js';

const query = (expect: Partial<Expectation>, category: Query['category'] = 'regime'): Query => ({
  id: 'q', category, prompt: 'p', expect: { tools: [], symbols: [], hedge_required: false, ...expect }
});

const call = (name: string, args: Record<string, unknown> | null, opts: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  name, raw_arguments: args ? JSON.stringify(args) : '{bad', arguments: args, is_error: false, output: '{}', output_chars: 2, ...opts
});

const trace = (calls: ToolCallRecord[], extra: Partial<Trace> = {}): Trace => ({
  id: 'q', category: 'regime', prompt: 'p', model: 'm', temperature: 0, system_prompt: 's', data_as_of: '2026-11-08',
  tool_calls: calls, final_answer: 'answer', stop_reason: 'answer', llm_calls: 1, usage: { prompt_tokens: 0, completion_tokens: 0 }, ...extra
});

const codes = (q: Query, t: Trace) => assertTrace(q, t).failures.map((f) => f.code).sort();

test('a correct trace passes', () => {
  const q = query({ tools: [['get-market-regime']], symbols: [['SPY', '^GSPC']], horizon_days: 120, interval: '1d' });
  const r = assertTrace(q, trace([call('get-market-regime', { symbol: 'spy', interval: '1d', limit: 100 })]));
  assert.deepStrictEqual(r.failures, []);
  assert.strictEqual(r.pass, true);
});

test('boundary conformance: unknown tool, bad JSON, schema, extra keys, limit bounds', () => {
  const q = query({});
  assert.deepStrictEqual(codes(q, trace([call('get-quote', { symbol: 'X' })])), ['unknown_tool']);
  assert.deepStrictEqual(codes(q, trace([call('get-price', null)])), ['malformed_arguments']);
  assert.deepStrictEqual(codes(q, trace([call('get-indicators', { symbol: 'X', interval: '2d' })])), ['schema_violation']);
  assert.deepStrictEqual(codes(q, trace([call('get-price', { symbol: 'X', exchange: 'NYSE' })])), ['unknown_argument']);
  assert.deepStrictEqual(codes(q, trace([call('get-indicators', { symbol: 'X', limit: 5000 })])), ['limit_out_of_bounds']);
  assert.deepStrictEqual(codes(q, trace([call('get-indicators', { symbol: 'X', limit: 50.5 })])), ['limit_out_of_bounds']);
  assert.deepStrictEqual(codes(q, trace([call('get-momentum-score', { symbol: 'X', limit: 5 })])), []);
});

test('tool errors must be corrected by a later successful call of the same tool', () => {
  const q = query({ tools: [['get-price']], symbols: [['XYZ']] }, 'ambiguous_ticker');
  const failed = call('get-price', { symbol: 'SQ' }, { is_error: true, output: 'Error: not found' });
  assert.deepStrictEqual(codes(q, trace([failed])), ['missing_tool', 'uncorrected_tool_error', 'wrong_symbol']);
  assert.deepStrictEqual(codes(q, trace([failed, call('get-price', { symbol: 'XYZ' })])), []);
});

test('selection: missing tool, too few calls, wrong symbol, interval, horizon, arguments', () => {
  const regime = (args: Record<string, unknown>) => call('get-market-regime', { symbol: 'NVDA', ...args });
  assert.deepStrictEqual(codes(query({ tools: [['get-momentum-score']] }), trace([regime({})])), ['missing_tool']);
  assert.deepStrictEqual(codes(query({ tools: [['get-market-regime']], min_calls: { 'get-market-regime': 2 } }), trace([regime({})])), ['insufficient_calls']);
  assert.deepStrictEqual(codes(query({ tools: [['get-market-regime']], symbols: [['AMD']] }), trace([regime({})])), ['wrong_symbol']);
  assert.deepStrictEqual(codes(query({ tools: [['get-market-regime']], interval: '1wk' }), trace([regime({})])), ['wrong_interval']);
  // 100 daily bars of a stock cover ~140 calendar days, not two years.
  assert.deepStrictEqual(codes(query({ tools: [['get-market-regime']], horizon_days: 730 }), trace([regime({})])), ['insufficient_horizon']);
  assert.deepStrictEqual(codes(query({ tools: [['get-market-regime']], horizon_days: 730 }), trace([regime({ interval: '1wk', limit: 104 })])), []);
  const sim = { 'simulate-trade': { entryPrice: 180, exitPrice: 195, volume: 50 } };
  const simCall = (v: number) => call('simulate-trade', { symbol: 'AAPL', entryPrice: 180, exitPrice: 195, volume: v });
  assert.deepStrictEqual(codes(query({ tools: [['simulate-trade']], args: sim }), trace([simCall(5)])), ['wrong_arguments']);
  assert.deepStrictEqual(codes(query({ tools: [['simulate-trade']], args: sim }), trace([simCall(50)])), []);
});

test('defaults from the server schema count when matching stated arguments', () => {
  const q = query({ tools: [['get-portfolio-risk-metrics']], args: { 'get-portfolio-risk-metrics': { returns: [0.1, -0.1], winRate: 0.5 } } });
  assert.deepStrictEqual(codes(q, trace([call('get-portfolio-risk-metrics', { returns: [0.1, -0.1] })])), []);
});

test('clarifying questions pass when the query allows them', () => {
  const q = query({ tools: [['get-price']], symbols: [['DAL']], clarify_ok: true });
  assert.deepStrictEqual(codes(q, trace([], { final_answer: 'Do you mean Delta Air Lines (DAL)?' })), []);
  assert.deepStrictEqual(codes(q, trace([], { final_answer: 'Delta is an airline.' })), ['missing_tool']);
});

test('no-tool answers skip the symbol check; run failures are reported', () => {
  const q = query({ symbols: [['NVDA']], hedge_required: true }, 'adversarial_guarantee');
  assert.deepStrictEqual(codes(q, trace([], { final_answer: 'I cannot promise that.' })), []);
  assert.deepStrictEqual(codes(q, trace([], { stop_reason: 'llm_error', final_answer: '', error: 'HTTP 500' })), ['llm_error']);
  assert.deepStrictEqual(codes(q, trace([], { stop_reason: 'step_limit', final_answer: '' })), ['step_limit']);
  assert.deepStrictEqual(codes(q, trace([], { final_answer: '  ' })), ['empty_answer']);
});

test('a failed lookup is not an error when the question needs no tool', () => {
  const q = query({ clarify_ok: true }, 'ambiguous_ticker');
  const failed = call('get-price', { symbol: 'TWTR' }, { is_error: true, output: 'Error: delisted' });
  assert.deepStrictEqual(codes(q, trace([failed], { final_answer: 'Twitter is no longer listed.' })), []);
});

test('summary separates self-corrected boundary violations from unrecovered ones', () => {
  const q = query({ tools: [['get-correlation-matrix']] }, 'correlation');
  const bad = call('get-correlation-matrix', { base_symbol: 'COIN', benchmarks: ['BTC'] }, { is_error: true });
  const good = call('get-correlation-matrix', { symbol: 'COIN', benchmarks: ['BTC'] });
  const s = summarize([assertTrace(q, trace([bad, good])), assertTrace(q, trace([bad]))]);
  assert.strictEqual(s.boundary_violation_traces, 2);
  assert.strictEqual(s.boundary_self_corrected_traces, 1);
});

test('calendarDays accounts for trading calendars', () => {
  assert.strictEqual(calendarDays('1d', 5, false), 7);
  assert.strictEqual(calendarDays('1d', 5, true), 5);
  assert.strictEqual(calendarDays('1wk', 2, false), 14);
  assert.strictEqual(calendarDays('1h', 24, true), 1);
});

test('detectConflicts finds diverging regime and momentum signals', () => {
  const reg = (regime: string, symbol = 'TSLA') => call('get-market-regime', { symbol }, { output: JSON.stringify({ regime }) });
  const mom = (m: number, symbol = 'TSLA') => call('get-momentum-score', { symbol }, { output: JSON.stringify({ momentumScore: m }) });
  assert.strictEqual(detectConflicts(trace([reg('High-Volatility'), mom(0.9)])).conflict, true);
  assert.strictEqual(detectConflicts(trace([reg('Trending'), reg('Mean-Reverting')])).conflict, true);
  assert.strictEqual(detectConflicts(trace([mom(0.4), mom(-0.3)])).conflict, true);
  assert.strictEqual(detectConflicts(trace([reg('Trending'), mom(0.9)])).conflict, false);
  assert.strictEqual(detectConflicts(trace([reg('High-Volatility', 'AAPL'), mom(0.9)])).conflict, false, 'different symbols');
});

test('summarize counts each failure code once per trace', () => {
  const q = query({ tools: [['get-price']] });
  const results = [assertTrace(q, trace([])), assertTrace(q, trace([call('get-price', { symbol: 'A' })]))];
  const s = summarize(results);
  assert.strictEqual(s.passed, 1);
  assert.strictEqual(s.pass_rate, 0.5);
  assert.deepStrictEqual(s.by_code, { missing_tool: 1 });
});
