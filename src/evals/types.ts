// src/evals/types.ts
// Shapes shared by the benchmark runner, the Level 1 assertions and the Level 2 judge.

export type Category =
  | 'lookup'
  | 'indicators'
  | 'regime'
  | 'multi_horizon'
  | 'ambiguous_ticker'
  | 'correlation'
  | 'risk'
  | 'regime_conflict'
  | 'adversarial_guarantee';

export const CATEGORIES: readonly Category[] = [
  'lookup', 'indicators', 'regime', 'multi_horizon', 'ambiguous_ticker',
  'correlation', 'risk', 'regime_conflict', 'adversarial_guarantee'
];

/** What a correct agent run must contain. Every field is checked deterministically (Level 1). */
export interface Expectation {
  /** Groups of tool names. Every group must be satisfied by one successful call to any tool in it. */
  tools: string[][];
  /** Groups of acceptable symbols. Every group must appear in at least one successful call. */
  symbols: string[][];
  /** Level 2 relevance: the answer must hedge or decline rather than give certain advice. */
  hedge_required: boolean;
  /** Calendar days of history the question asks about; the longest successful call must cover it. */
  horizon_days?: number;
  /** Bar interval the question asks for, when it names one. */
  interval?: string;
  /** Argument values the question states explicitly, per tool. */
  args?: Record<string, Record<string, unknown>>;
  /** Minimum number of successful calls per tool (multi-horizon comparisons). */
  min_calls?: Record<string, number>;
  /** A clarifying question with no tool calls also passes. */
  clarify_ok?: boolean;
}

export interface Query {
  id: string;
  category: Category;
  prompt: string;
  expect: Expectation;
  note?: string;
}

export interface ToolCallRecord {
  name: string;
  /** Arguments exactly as the model produced them. */
  raw_arguments: string;
  /** Parsed arguments, or null when raw_arguments is not valid JSON. */
  arguments: Record<string, unknown> | null;
  is_error: boolean;
  /** Tool output text (images replaced by a placeholder), truncated to TRACE_OUTPUT_CHARS. */
  output: string;
  output_chars: number;
}

export type StopReason = 'answer' | 'step_limit' | 'llm_error';

export interface Trace {
  id: string;
  category: Category;
  prompt: string;
  model: string;
  temperature: number;
  system_prompt: string;
  data_as_of: string;
  tool_calls: ToolCallRecord[];
  final_answer: string;
  stop_reason: StopReason;
  error?: string;
  llm_calls: number;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export const TRACE_OUTPUT_CHARS = 3000;
