// src/evals/judge.ts
// Level 2: a pinned, single-criterion binary LLM judge ("does the answer give unhedged
// financial advice?"). It sees only what the agent saw: system prompt, user message,
// tool calls and outputs, final answer. Never the model's hidden reasoning.
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { LlmClient } from './llm.js';
import type { Trace } from './types.js';

export interface JudgeConfig {
  version: number;
  model: string;
  temperature: number;
  criterion: string;
  positive_class: 'FAIL';
  tool_output_chars: number;
  rubric: string;
}

export interface JudgeVerdict {
  /** Trace file the verdict belongs to (basename without .jsonl), e.g. `beam_cloud`. */
  traces: string;
  id: string;
  judge_version: number;
  judge_model: string;
  verdict: 'PASS' | 'FAIL' | 'INVALID';
  confidence: number;
  /** Probability-like score that the trace is a FAIL; used for threshold calibration. */
  p_fail: number;
  reason: string;
}

export function loadJudgeConfig(file: string): JudgeConfig {
  const cfg = parseYaml(readFileSync(file, 'utf8')) as JudgeConfig;
  for (const k of ['version', 'model', 'temperature', 'rubric', 'tool_output_chars'] as const) {
    if (cfg[k] === undefined) throw new Error(`judge config is missing "${k}"`);
  }
  return cfg;
}

export function renderTrace(t: Trace, toolOutputChars: number): string {
  const lines = [
    '<system_instructions>', t.system_prompt, '</system_instructions>',
    '<user>', t.prompt, '</user>'
  ];
  t.tool_calls.forEach((c, i) => {
    const out = c.output.length > toolOutputChars ? `${c.output.slice(0, toolOutputChars)}\n[... truncated]` : c.output;
    lines.push(`<tool_call n="${i + 1}" name="${c.name}" error="${c.is_error}">`, `arguments: ${c.raw_arguments}`, 'output:', out, '</tool_call>');
  });
  lines.push('<final_answer>', t.final_answer || '(no final answer)', '</final_answer>');
  return lines.join('\n');
}

export function parseVerdict(text: string): Pick<JudgeVerdict, 'verdict' | 'confidence' | 'reason'> {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const obj = JSON.parse(match ? match[0] : text) as { verdict?: string; confidence?: number; reason?: string };
    const verdict = String(obj.verdict ?? '').toUpperCase();
    if (verdict !== 'PASS' && verdict !== 'FAIL') throw new Error('bad verdict');
    const c = Number(obj.confidence);
    const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0.5, c)) : 0.75;
    return { verdict, confidence, reason: String(obj.reason ?? '') };
  } catch {
    return { verdict: 'INVALID', confidence: 0, reason: text.slice(0, 200) };
  }
}

export async function judgeTrace(t: Trace, traces: string, cfg: JudgeConfig, llm: LlmClient): Promise<JudgeVerdict> {
  const res = await llm.chat({
    model: cfg.model,
    temperature: cfg.temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: cfg.rubric },
      { role: 'user', content: `<transcript>\n${renderTrace(t, cfg.tool_output_chars)}\n</transcript>` }
    ]
  });
  const v = parseVerdict(res.message.content ?? '');
  const p_fail = v.verdict === 'FAIL' ? v.confidence : v.verdict === 'PASS' ? 1 - v.confidence : 0.5;
  return { traces, id: t.id, judge_version: cfg.version, judge_model: cfg.model, ...v, p_fail: Number(p_fail.toFixed(4)) };
}
