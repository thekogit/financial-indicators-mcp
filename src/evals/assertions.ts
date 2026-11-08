// src/evals/assertions.ts
// Level 1: deterministic checks on one trace. No LLM, no network. Every failure code
// below is one node of the failure taxonomy reported in evals/results/.
import { z } from 'zod';
import { TOOL_INPUTS } from '../server.js';
import type { Query, ToolCallRecord, Trace } from './types.js';

export type FailureCode =
  | 'llm_error'
  | 'step_limit'
  | 'empty_answer'
  | 'unknown_tool'
  | 'malformed_arguments'
  | 'schema_violation'
  | 'unknown_argument'
  | 'limit_out_of_bounds'
  | 'uncorrected_tool_error'
  | 'missing_tool'
  | 'insufficient_calls'
  | 'wrong_symbol'
  | 'wrong_interval'
  | 'insufficient_horizon'
  | 'wrong_arguments';

export const FAILURE_CODES: readonly FailureCode[] = [
  'llm_error', 'step_limit', 'empty_answer', 'unknown_tool', 'malformed_arguments', 'schema_violation',
  'unknown_argument', 'limit_out_of_bounds', 'uncorrected_tool_error', 'missing_tool', 'insufficient_calls',
  'wrong_symbol', 'wrong_interval', 'insufficient_horizon', 'wrong_arguments'
];

export interface Failure { code: FailureCode; detail: string }

export interface ConflictSignals {
  conflict: boolean;
  reasons: string[];
}

export interface Level1Result {
  id: string;
  category: Query['category'];
  pass: boolean;
  failures: Failure[];
  signals: ConflictSignals;
}

/** Domain bounds on `limit` (stricter than the current server schema; see the fixes plan, P1.2). */
export const LIMIT_BOUNDS: Record<string, [number, number]> = {
  'get-indicators': [20, 1000],
  'plot-indicators': [20, 1000],
  'get-market-regime': [20, 1000],
  'get-engineered-features': [20, 1000],
  'get-correlation-matrix': [20, 1000],
  'get-momentum-score': [2, 1000]
};

const schemas: Record<string, z.ZodObject<z.ZodRawShape>> = Object.fromEntries(
  Object.entries(TOOL_INPUTS).map(([name, shape]) => [name, z.object(shape as z.ZodRawShape)])
);

/** Arguments after the server's own schema has applied defaults, or null if they don't parse. */
export function parsedArgs(call: ToolCallRecord): Record<string, unknown> | null {
  const schema = schemas[call.name];
  if (!schema || call.arguments === null) return null;
  const r = schema.safeParse(call.arguments);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

const norm = (s: unknown) => String(s).trim().toUpperCase();
const isCryptoSymbol = (s: string) => s.includes('/') || ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT'].includes(s.split('/')[0].toUpperCase());

/** Calendar days covered by `bars` bars of `interval` (stocks trade ~5/7 days, ~6.5 h a day). */
export function calendarDays(interval: string, bars: number, crypto: boolean): number {
  const perBar: Record<string, [number, number]> = {
    // [stock, crypto] calendar days per bar
    '1m': [7 / 5 / 390, 1 / 1440],
    '5m': [7 / 5 / 78, 1 / 288],
    '1h': [7 / 5 / 6.5, 1 / 24],
    '1d': [7 / 5, 1],
    '1wk': [7, 7]
  };
  const [stock, cr] = perBar[interval] ?? perBar['1d'];
  return bars * (crypto ? cr : stock);
}

function symbolsOf(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof args.symbol === 'string') out.push(args.symbol);
  if (Array.isArray(args.benchmarks)) for (const b of args.benchmarks) if (typeof b === 'string') out.push(b);
  return out;
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(expected - actual) <= 1e-6 * Math.max(1, Math.abs(expected));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => valuesMatch(e, actual[i]));
  }
  return expected === actual;
}

export function detectConflicts(trace: Trace): ConflictSignals {
  const regimes: { symbol: string; regime: string }[] = [];
  const momenta: { symbol: string; score: number }[] = [];
  for (const c of trace.tool_calls) {
    if (c.is_error || !c.arguments) continue;
    const symbol = norm(c.arguments.symbol ?? '');
    try {
      const out = JSON.parse(c.output);
      if (c.name === 'get-market-regime' && typeof out.regime === 'string') regimes.push({ symbol, regime: out.regime });
      if (c.name === 'get-momentum-score' && typeof out.momentumScore === 'number') momenta.push({ symbol, score: out.momentumScore });
    } catch { /* truncated or non-JSON output: no signal */ }
  }
  const reasons = new Set<string>();
  for (const r of regimes) {
    const m = momenta.filter((x) => x.symbol === r.symbol);
    if (r.regime === 'High-Volatility' && m.some((x) => Math.abs(x.score) >= 0.5)) reasons.add(`${r.symbol}: High-Volatility regime with |momentum| >= 0.5`);
    if (r.regime === 'Mean-Reverting' && m.some((x) => Math.abs(x.score) >= 0.5)) reasons.add(`${r.symbol}: Mean-Reverting regime with |momentum| >= 0.5`);
    if (regimes.some((o) => o.symbol === r.symbol && o.regime !== r.regime)) reasons.add(`${r.symbol}: regimes differ across horizons`);
  }
  for (const a of momenta) {
    if (momenta.some((b) => b.symbol === a.symbol && Math.abs(a.score) >= 0.2 && Math.abs(b.score) >= 0.2 && Math.sign(a.score) !== Math.sign(b.score))) {
      reasons.add(`${a.symbol}: momentum signs differ across horizons`);
    }
  }
  return { conflict: reasons.size > 0, reasons: [...reasons] };
}

export function assertTrace(q: Query, trace: Trace): Level1Result {
  const f: Failure[] = [];
  const add = (code: FailureCode, detail: string) => f.push({ code, detail });
  const e = q.expect;

  if (trace.stop_reason === 'llm_error') add('llm_error', trace.error ?? 'LLM call failed');
  if (trace.stop_reason === 'step_limit') add('step_limit', `no final answer after ${trace.llm_calls} LLM calls`);
  if (trace.stop_reason === 'answer' && trace.final_answer.trim() === '') add('empty_answer', 'final answer is empty');

  // Per-call conformance at the MCP boundary.
  trace.tool_calls.forEach((c, i) => {
    const at = `call ${i + 1} (${c.name})`;
    const shape = (TOOL_INPUTS as Record<string, z.ZodRawShape>)[c.name];
    if (!shape) { add('unknown_tool', `${at}: no such tool`); return; }
    if (c.arguments === null) { add('malformed_arguments', `${at}: ${c.raw_arguments.slice(0, 80)}`); return; }
    const extra = Object.keys(c.arguments).filter((k) => !(k in shape));
    if (extra.length) add('unknown_argument', `${at}: ${extra.join(', ')}`);
    const parsed = schemas[c.name].safeParse(c.arguments);
    if (!parsed.success) { add('schema_violation', `${at}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`); return; }
    const bounds = LIMIT_BOUNDS[c.name];
    const limit = (parsed.data as { limit?: number }).limit;
    if (bounds && limit !== undefined && (!Number.isInteger(limit) || limit < bounds[0] || limit > bounds[1])) {
      add('limit_out_of_bounds', `${at}: limit=${limit}, allowed integer in [${bounds[0]}, ${bounds[1]}]`);
    }
  });

  // When the question needs no tool (e.g. a delisted company), a failed lookup is evidence,
  // not a mistake: the answer is what matters.
  trace.tool_calls.forEach((c, i) => {
    if (e.tools.length > 0 && c.is_error &&!trace.tool_calls.slice(i + 1).some((l) => l.name === c.name && !l.is_error)) {
      add('uncorrected_tool_error', `call ${i + 1} (${c.name}) failed and was never retried successfully: ${c.output.slice(0, 100)}`);
    }
  });

  const ok = trace.tool_calls.filter((c) => !c.is_error && parsedArgs(c) !== null);
  const clarified = e.clarify_ok === true && trace.tool_calls.length === 0 && trace.final_answer.includes('?');

  if (!clarified) {
    for (const group of e.tools) {
      if (!ok.some((c) => group.includes(c.name))) add('missing_tool', `none of [${group.join(', ')}] called successfully`);
    }
    for (const [tool, n] of Object.entries(e.min_calls ?? {})) {
      const got = ok.filter((c) => c.name === tool).length;
      if (got < n) add('insufficient_calls', `${tool}: ${got} successful call(s), expected >= ${n}`);
    }
    // With no calls at all, missing_tool already describes the failure.
    if (trace.tool_calls.length > 0) {
      const used = new Set(ok.flatMap((c) => symbolsOf(c.arguments!).map(norm)));
      for (const group of e.symbols) {
        if (!group.some((s) => used.has(norm(s)))) add('wrong_symbol', `none of [${group.join(', ')}] used; got [${[...used].join(', ')}]`);
      }
    }
    const relevant = ok.filter((c) => e.tools.flat().includes(c.name));
    if (e.interval && relevant.length && !relevant.some((c) => (parsedArgs(c)!.interval ?? '1d') === e.interval)) {
      add('wrong_interval', `expected ${e.interval}; got [${relevant.map((c) => parsedArgs(c)!.interval ?? '-').join(', ')}]`);
    }
    if (e.horizon_days && relevant.length) {
      const covered = Math.max(0, ...relevant.map((c) => {
        const a = parsedArgs(c)!;
        if (typeof a.limit !== 'number') return Infinity; // tool without a lookback window
        return calendarDays(String(a.interval ?? '1d'), a.limit, isCryptoSymbol(String(a.symbol ?? '')));
      }));
      if (covered < 0.8 * e.horizon_days) add('insufficient_horizon', `covers ~${covered.toFixed(1)} days, question asks about ${e.horizon_days}`);
    }
    for (const [tool, want] of Object.entries(e.args ?? {})) {
      const calls = ok.filter((c) => c.name === tool);
      if (calls.length && !calls.some((c) => Object.entries(want).every(([k, v]) => valuesMatch(v, parsedArgs(c)![k])))) {
        add('wrong_arguments', `${tool}: expected ${JSON.stringify(want).slice(0, 120)}`);
      }
    }
  }

  return { id: trace.id, category: trace.category, pass: f.length === 0, failures: f, signals: detectConflicts(trace) };
}

export interface Level1Summary {
  traces: number;
  passed: number;
  pass_rate: number;
  by_category: Record<string, { traces: number; passed: number }>;
  by_code: Record<string, number>;
  conflict_traces: number;
  /** Traces with at least one call that broke the tool schema at the MCP boundary... */
  boundary_violation_traces: number;
  /** ...and of those, the ones where the agent still recovered (no uncorrected error, no missing tool, an answer). */
  boundary_self_corrected_traces: number;
}

const BOUNDARY: FailureCode[] = ['unknown_tool', 'malformed_arguments', 'schema_violation', 'unknown_argument'];
const UNRECOVERED: FailureCode[] = ['uncorrected_tool_error', 'missing_tool', 'step_limit', 'empty_answer', 'llm_error'];

export function summarize(results: Level1Result[]): Level1Summary {
  const by_category: Level1Summary['by_category'] = {};
  const by_code: Record<string, number> = {};
  for (const r of results) {
    const c = (by_category[r.category] ??= { traces: 0, passed: 0 });
    c.traces++;
    if (r.pass) c.passed++;
    for (const code of new Set(r.failures.map((x) => x.code))) by_code[code] = (by_code[code] ?? 0) + 1;
  }
  const passed = results.filter((r) => r.pass).length;
  const boundary = results.filter((r) => r.failures.some((f) => BOUNDARY.includes(f.code)));
  return {
    traces: results.length,
    passed,
    pass_rate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
    by_category,
    by_code: Object.fromEntries(Object.entries(by_code).sort((a, b) => b[1] - a[1])),
    conflict_traces: results.filter((r) => r.signals.conflict).length,
    boundary_violation_traces: boundary.length,
    boundary_self_corrected_traces: boundary.filter((r) => !r.failures.some((f) => UNRECOVERED.includes(f.code))).length
  };
}
