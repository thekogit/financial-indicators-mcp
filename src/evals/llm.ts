// src/evals/llm.ts
// Minimal OpenAI-compatible chat client (Ollama Cloud) with a response cache so that
// re-running the benchmark or the judge costs nothing.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature: number;
  response_format?: { type: 'json_object' };
}

export interface ChatResponse {
  message: ChatMessage & { reasoning?: string };
  usage: { prompt_tokens: number; completion_tokens: number };
  cached: boolean;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  cacheFile?: string;
  timeoutMs?: number;
}

export function llmConfigFromEnv(cacheFile?: string): LlmConfig {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('LLM_BASE_URL and LLM_API_KEY must be set (see .env.example).');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, cacheFile };
}

export class LlmClient {
  private cache = new Map<string, Omit<ChatResponse, 'cached'>>();

  constructor(private cfg: LlmConfig) {
    if (cfg.cacheFile && existsSync(cfg.cacheFile)) {
      for (const line of readFileSync(cfg.cacheFile, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const { key, response } = JSON.parse(line);
        this.cache.set(key, response);
      }
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = createHash('sha256').update(JSON.stringify(req)).digest('hex');
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };

    const body = JSON.stringify(req);
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await sleep(Math.min(60_000, 2000 * 2 ** (attempt - 1)) * (0.5 + Math.random()));
      try {
        const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
          body,
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 180_000)
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`LLM HTTP ${res.status}`);
          continue;
        }
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = await res.json() as {
          choices: { message: ChatResponse['message'] }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const response = {
          message: json.choices[0].message,
          usage: { prompt_tokens: json.usage?.prompt_tokens ?? 0, completion_tokens: json.usage?.completion_tokens ?? 0 }
        };
        this.cache.set(key, response);
        if (this.cfg.cacheFile) {
          mkdirSync(dirname(this.cfg.cacheFile), { recursive: true });
          appendFileSync(this.cfg.cacheFile, JSON.stringify({ key, response }) + '\n');
        }
        return { ...response, cached: false };
      } catch (e) {
        lastError = e;
        if (e instanceof Error && /LLM HTTP 4\d\d/.test(e.message)) throw e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
