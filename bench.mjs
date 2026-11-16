import { runAllOrAbort } from "./lib/run-all.mjs";

const N = Number(process.argv[2] ?? 1_000_000);
const RUNS = Number(process.argv[3] ?? 7);
const mode = process.argv[4] ?? "empty"; // empty | io

const work = mode === "io"
  ? async () => { await new Promise((r) => setTimeout(r, 1)); }
  : async () => {};
const tasks = Array.from({ length: N }, () => work);

const variants = {
  ...(mode === "io" ? {} : { "sequential await": async () => { for (let i = 0; i < N; i++) await work(); } }),
  "Promise.all": async () => { await Promise.all(tasks.map((t) => t())); },
  "runAllOrAbort": async () => { await runAllOrAbort(tasks); },
};

const results = {};
for (const name of Object.keys(variants)) results[name] = [];

// warmup (smaller N not possible with shared tasks; one full pass each)
for (const fn of Object.values(variants)) await fn();

// interleave runs to reduce order bias
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of Object.entries(variants)) {
    if (global.gc) global.gc();
    const t0 = performance.now();
    await fn();
    results[name].push(performance.now() - t0);
  }
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`N=${N} runs=${RUNS} mode=${mode} node=${process.version}`);
for (const [name, a] of Object.entries(results)) {
  console.log(
    name.padEnd(18),
    "median", median(a).toFixed(1).padStart(8), "ms",
    "min", Math.min(...a).toFixed(1).padStart(8),
    "max", Math.max(...a).toFixed(1).padStart(8)
  );
}
