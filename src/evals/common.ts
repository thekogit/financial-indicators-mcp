// src/evals/common.ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Query, Trace } from './types.js';

/** Repository root (this file compiles to dist/evals/common.js). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  queries: join(ROOT, 'evals', 'datasets', 'queries.jsonl'),
  fixtures: join(ROOT, 'evals', 'fixtures'),
  traces: join(ROOT, 'evals', 'traces'),
  results: join(ROOT, 'evals', 'results'),
  labels: join(ROOT, 'evals', 'labels', 'reference_labels.jsonl'),
  judgeConfig: join(ROOT, 'evals', 'judge.yaml'),
  llmCache: join(ROOT, 'data', 'llm_cache.jsonl')
};

/** Loads `.env` from the repo root if present. Never prints values. */
export function loadEnv(): void {
  const file = join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

export function toJsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export const loadQueries = (file = PATHS.queries) => readJsonl<Query>(file);
export const loadTraces = (file: string) => readJsonl<Trace>(file);

/** File-name-safe form of a model id, e.g. `beam:cloud` -> `beam_cloud`. */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

/** Minimal `--flag value` / `--flag` parser for the eval CLIs. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
