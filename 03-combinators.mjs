// Cases E and F: the same three operations under each strategy.
//
//   A  rejects at ~50 ms
//   B  fulfils at ~150 ms and writes to the store
//   C  fulfils at ~250 ms and writes to the store
//
// For every strategy we record when the aggregate settled and which side effects
// happened AFTER that moment.
import { sleep } from './lib/timeline.mjs';

function makeOps(t0, store) {
  const now = () => Math.round(performance.now() - t0);
  const op = (name, ms, behaviour) => () =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (behaviour === 'reject') return reject(new Error(`${name} failed`));
        store.push({ name, at: now() });
        resolve(`${name} result`);
      }, ms);
    });
  return { now, ops: [op('A', 50, 'reject'), op('B', 150, 'write'), op('C', 250, 'write')] };
}

async function trial(label, strategy) {
  const t0 = performance.now();
  const store = [];
  const { now, ops } = makeOps(t0, store);
  let settledAt = null;
  let outcome;

  try {
    const value = await strategy(ops);
    outcome = `fulfilled: ${JSON.stringify(value)}`;
  } catch (e) {
    outcome = e instanceof AggregateError
      ? `rejected: AggregateError(${e.errors.map((x) => x.message)})`
      : `rejected: ${e.message}`;
  }
  settledAt = now();

  const atSettle = store.filter((s) => s.at <= settledAt).map((s) => s.name);
  await sleep(350); // let everything that is going to happen, happen
  const after = store.filter((s) => s.at > settledAt).map((s) => s.name);

  return { label, settledAt, outcome, atSettle: atSettle.join(',') || '-', after: after.join(',') || '-' };
}

const rows = [
  await trial('Promise.all', (ops) => Promise.all(ops.map((f) => f()))),
  await trial('Promise.allSettled', async (ops) =>
    (await Promise.allSettled(ops.map((f) => f()))).map((o) => o.status)),
  await trial('Promise.any', (ops) => Promise.any(ops.map((f) => f()))),
  await trial('sequential await', async (ops) => {
    const out = [];
    for (const f of ops) out.push(await f()); // stops at the first failure; later ops never start
    return out;
  }),
];

console.table(
  rows.map((r) => ({
    strategy: r.label,
    'settled at': `${r.settledAt} ms`,
    outcome: r.outcome,
    'writes before settle': r.atSettle,
    'writes AFTER settle': r.after,
  })),
);

// Promise.any: errors come back in input order, not completion order.
const slowFirst = new Promise((_, rej) => setTimeout(rej, 80, new Error('first input (slow)')));
const fastSecond = new Promise((_, rej) => setTimeout(rej, 20, new Error('second input (fast)')));
await Promise.any([slowFirst, fastSecond]).catch((e) => {
  console.log('\nPromise.any AggregateError.errors order:', e.errors.map((x) => x.message));
});
