// Case G: cooperative cancellation with a shared AbortController.
//
//   E  finishes at ~20 ms, BEFORE the failure (already done, abort cannot undo it)
//   A  fails at ~50 ms (the genuine failure)
//   B  uses Node's timers/promises setTimeout with { signal } (an API that supports abort)
//   C  hand-written timer that honours the signal and clears its timer
//   D  ignores the signal entirely
//
// Run twice: once waiting for settlement, once giving up after 100 ms.
import { setTimeout as timersSleep } from 'node:timers/promises';
import { createTimeline, sleep } from './lib/timeline.mjs';
import { runAllOrAbort, GroupFailedError } from './lib/run-all.mjs';

const NAMES = ['E', 'A', 'B', 'C', 'D'];

async function scenario(title, settleTimeoutMs) {
  console.log(`\n=== ${title} ===`);
  const { log } = createTimeline();
  const effects = [];
  const effect = (n) => { effects.push(n); log(`${n} side effect performed`); };

  const tasks = [
    // E: completes before the failure
    async () => { await sleep(20); effect('E'); return 'E ok'; },
    // A: genuine failure
    async () => { await sleep(50); log('A throws'); throw new Error('A failed'); },
    // B: real API that supports AbortSignal
    async (signal) => {
      try { const v = await timersSleep(150, 'B ok', { signal }); effect('B'); return v; }
      catch (e) { log(`B rejected: name=${e.name}, cause is signal.reason: ${e.cause === signal.reason}`); throw e; }
    },
    // C: hand-written, honours the signal
    (signal) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason); // a cooperative task also checks before it starts
      const t = setTimeout(() => { effect('C'); resolve('C ok'); }, 250);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        log('C received abort and cleared its timer');
        reject(signal.reason);
      }, { once: true });
    }),
    // D: ignores the signal
    async () => { await sleep(250); effect('D'); return 'D ok'; },
  ];

  let snapshot;
  let err;
  try {
    await runAllOrAbort(tasks, { settleTimeoutMs });
  } catch (e) {
    err = e;
    if (!(e instanceof GroupFailedError)) throw e;
    log(`runAllOrAbort threw: cause="${e.cause.message}"`);
    snapshot = e.outcomes;
  }

  console.log('\nWhat the caller knows when runAllOrAbort throws:');
  console.table(snapshot.map((o, i) => ({
    task: NAMES[i],
    status: o.status,
    'abort-induced': o.abortInduced ?? '-',
    'observed after abort': o.observedAfterAbort ?? '-',
  })));

  await sleep(400);
  const final = await err.whenSettled;
  console.log('Final outcomes once every task has settled:');
  console.table(final.map((o, i) => ({ task: NAMES[i], status: o.status, 'abort-induced': o.abortInduced ?? '-' })));
  console.log('Side effects that happened in total:', effects.join(', '));
}

await scenario('Mode 1: wait for every task to settle after aborting', 1000);
await scenario('Mode 2: stop waiting 100 ms after aborting', 100);
