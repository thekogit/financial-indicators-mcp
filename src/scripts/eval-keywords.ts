import { readFileSync } from 'node:fs';
import { analyzeSentiment } from '../services/primes/intelligence.js';

const labels: Record<string, number> = { positive: 1, neutral: 0, negative: -1 };
const lines = readFileSync(process.argv[2], 'latin1').split(/\r?\n/).filter(Boolean);
let correct = 0, neutral = 0;
const confusion: Record<string, number> = {};
for (const line of lines) {
  const at = line.lastIndexOf('@');
  const gold = labels[line.slice(at + 1).trim()];
  const s = analyzeSentiment([line.slice(0, at)]).score;
  const pred = s > 0 ? 1 : s < 0 ? -1 : 0;
  if (pred === gold) correct++;
  if (gold === 0) neutral++;
  confusion[`${gold}->${pred}`] = (confusion[`${gold}->${pred}`] ?? 0) + 1;
}
console.log(`n=${lines.length} accuracy=${(correct / lines.length).toFixed(3)} always-neutral baseline=${(neutral / lines.length).toFixed(3)}`);
console.log(confusion);
