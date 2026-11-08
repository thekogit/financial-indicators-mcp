// src/evals/agent.ts
// Runs one benchmark query: an LLM with the server's tools, talking to the real MCP
// server over an in-memory transport, until it answers or hits the step limit.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type MarketDataDeps } from '../server.js';
import type { ChatMessage, ChatTool, LlmClient } from './llm.js';
import { TRACE_OUTPUT_CHARS, type Query, type ToolCallRecord, type Trace } from './types.js';

export const SYSTEM_PROMPT_TEMPLATE = [
  'You are a market-analysis assistant connected to the financial-indicators MCP server.',
  'Market data is as of {DATA_AS_OF}.',
  'Use the tools to get numbers instead of guessing them, then answer the user concisely.'
].join(' ');

export interface AgentOptions {
  llm: LlmClient;
  model: string;
  temperature: number;
  marketData: MarketDataDeps;
  dataAsOf: string;
  maxSteps?: number;
}

interface CallResult { content?: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }

function resultText(r: CallResult): string {
  return (r.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.mimeType ?? c.type} ${c.data?.length ?? 0} base64 chars]`))
    .join('\n');
}

export async function runQuery(q: Query, opts: AgentOptions): Promise<Trace> {
  const system = SYSTEM_PROMPT_TEMPLATE.replace('{DATA_AS_OF}', opts.dataAsOf);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createServer(opts.marketData);
  const client = new Client({ name: 'fim-eval-agent', version: '1.0.0' });
  await server.connect(serverT);
  await client.connect(clientT);

  const trace: Trace = {
    id: q.id, category: q.category, prompt: q.prompt, model: opts.model, temperature: opts.temperature,
    system_prompt: system, data_as_of: opts.dataAsOf, tool_calls: [], final_answer: '',
    stop_reason: 'step_limit', llm_calls: 0, usage: { prompt_tokens: 0, completion_tokens: 0 }
  };

  try {
    const { tools } = await client.listTools();
    const chatTools: ChatTool[] = tools.map((t) => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema }
    }));
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: q.prompt }];

    for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
      const res = await opts.llm.chat({ model: opts.model, messages, tools: chatTools, temperature: opts.temperature });
      trace.llm_calls++;
      trace.usage.prompt_tokens += res.usage.prompt_tokens;
      trace.usage.completion_tokens += res.usage.completion_tokens;
      const calls = res.message.tool_calls ?? [];
      if (calls.length === 0) {
        trace.final_answer = res.message.content ?? '';
        trace.stop_reason = 'answer';
        break;
      }
      messages.push({ role: 'assistant', content: res.message.content ?? '', tool_calls: calls });
      for (const call of calls) {
        const rec = await callTool(client, call.function.name, call.function.arguments);
        trace.tool_calls.push({ ...rec, output: rec.output.slice(0, TRACE_OUTPUT_CHARS) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: rec.output });
      }
    }
  } catch (e) {
    trace.stop_reason = 'llm_error';
    trace.error = e instanceof Error ? e.message : String(e);
  } finally {
    await client.close();
    await server.close();
  }
  return trace;
}

async function callTool(client: Client, name: string, raw: string): Promise<ToolCallRecord> {
  let args: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw === '' ? '{}' : raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
  } catch { /* recorded as null below */ }
  if (args === null) {
    const output = 'Error: tool arguments are not a valid JSON object.';
    return { name, raw_arguments: raw, arguments: null, is_error: true, output, output_chars: output.length };
  }
  try {
    const r = await client.callTool({ name, arguments: args }) as CallResult;
    const output = resultText(r);
    return { name, raw_arguments: raw, arguments: args, is_error: r.isError === true, output, output_chars: output.length };
  } catch (e) {
    // The SDK throws McpError for unknown tools and, in some versions, for invalid arguments.
    const output = `Error: ${e instanceof Error ? e.message : String(e)}`;
    return { name, raw_arguments: raw, arguments: args, is_error: true, output, output_chars: output.length };
  }
}
