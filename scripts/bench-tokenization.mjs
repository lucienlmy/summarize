import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { countTokens } from "bpe-lite";

const args = process.argv.slice(2);
let filePath = null;
let iterations = 5;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--iterations" || arg === "-n") {
    const next = args[i + 1];
    const parsed = Number(next);
    if (!next || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --iterations value: ${next ?? ""}`);
    }
    iterations = Math.floor(parsed);
    i += 1;
    continue;
  }
  if (!filePath) {
    filePath = arg;
  }
}

if (!filePath) {
  console.error("Usage: node scripts/bench-tokenization.mjs <file> [--iterations 5]");
  process.exit(1);
}

const text = await readFile(filePath, "utf8");
const byteLength = Buffer.byteLength(text, "utf8");

const measure = (label, fn) => {
  const durations = [];
  let tokens = 0;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    tokens = fn();
    const end = performance.now();
    durations.push(end - start);
  }
  const total = durations.reduce((acc, value) => acc + value, 0);
  const avg = total / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  console.log(
    `${label}: tokens=${tokens} avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(
      2,
    )}ms`,
  );
};

const estimateTokens = () => Math.ceil(text.length / 4);

// Warm up tokenizer once to avoid first-run overhead in timing.
countTokens(text, "openai-o200k");

console.log(`file=${filePath}`);
console.log(`chars=${text.length} bytes=${byteLength}`);
console.log(`iterations=${iterations}`);

measure("estimate chars/4", estimateTokens);
measure("bpe-lite o200k", () => countTokens(text, "openai-o200k"));
