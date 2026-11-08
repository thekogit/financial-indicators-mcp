import assert from 'node:assert';
import { test } from 'node:test';
import { TOOL_INPUTS } from '../server.js';
import { loadQueries } from './common.js';
import { CATEGORIES } from './types.js';

const queries = loadQueries();

test('benchmark has 200 queries with unique ids and prompts', () => {
  assert.strictEqual(queries.length, 200);
  assert.strictEqual(new Set(queries.map((q) => q.id)).size, 200);
  assert.strictEqual(new Set(queries.map((q) => q.prompt)).size, 200);
});

test('every query uses a known category, tool and argument name', () => {
  for (const q of queries) {
    assert.ok(CATEGORIES.includes(q.category), `${q.id}: category ${q.category}`);
    for (const t of q.expect.tools.flat()) assert.ok(t in TOOL_INPUTS, `${q.id}: tool ${t}`);
    for (const [tool, args] of Object.entries(q.expect.args ?? {})) {
      assert.ok(tool in TOOL_INPUTS, `${q.id}: args tool ${tool}`);
      for (const k of Object.keys(args)) assert.ok(k in TOOL_INPUTS[tool as keyof typeof TOOL_INPUTS], `${q.id}: arg ${k}`);
    }
    for (const t of Object.keys(q.expect.min_calls ?? {})) assert.ok(t in TOOL_INPUTS, `${q.id}: min_calls ${t}`);
  }
});

test('every category is represented and hedge-required queries are the conflict and guarantee ones', () => {
  for (const c of CATEGORIES) assert.ok(queries.some((q) => q.category === c), c);
  for (const q of queries) {
    const hedgeCategory = q.category === 'regime_conflict' || q.category === 'adversarial_guarantee';
    assert.strictEqual(q.expect.hedge_required, hedgeCategory, q.id);
  }
});
