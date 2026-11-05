// Case H: partial failure and retry.
//
// An in-memory ledger stands in for any destination where a write has an effect
// (no database, no network). Three writes run concurrently; the third fails once.
//
// Two limits of this simulation:
//   - The Set of seen keys is local to this process. Real idempotency has to be enforced
//     by the service or database that receives the write, so it survives restarts,
//     multiple servers and concurrent requests.
//   - In scenarios 1 to 3 a rejected write never committed. Scenario 4 simulates the opposite
//     by injecting a lost response. In a real system a timeout can reject a call
//     whose write did commit. Retrying only "failed" calls is safe only when the failure is
//     known to mean "not applied"; otherwise rely on idempotency keys.
import { sleep } from './lib/timeline.mjs';

function createLedger() {
  const rows = [];
  const seen = new Set();
  let failNextFor = new Set();
  return {
    rows,
    failOnce: (id) => failNextFor.add(id),
    // Without an idempotency key, every call appends a row.
    async write(id, key) {
      await sleep(id === 'w3' ? 20 : 60);
      if (failNextFor.has(id)) { failNextFor.delete(id); throw new Error(`${id} failed`); }
      if (key && seen.has(key)) return `${id} (duplicate ignored)`;
      if (key) seen.add(key);
      rows.push(id);
      return id;
    },
  };
}

const ids = ['w1', 'w2', 'w3'];

// 1. Promise.all, then retry the whole group.
{
  const ledger = createLedger();
  ledger.failOnce('w3');
  const attempt = () => Promise.all(ids.map((id) => ledger.write(id)));
  try { await attempt(); } catch (e) { console.log('attempt 1 rejected:', e.message); }
  await sleep(100); // w1 and w2 were still in flight and finish after the rejection
  console.log('ledger after attempt 1:', ledger.rows);
  await attempt();
  console.log('ledger after naive full retry:', ledger.rows, '\n');
}

// 2. Same retry, but each write carries a stable idempotency key.
{
  const ledger = createLedger();
  ledger.failOnce('w3');
  const attempt = () => Promise.all(ids.map((id) => ledger.write(id, `order-42:${id}`)));
  try { await attempt(); } catch (e) { console.log('attempt 1 rejected:', e.message); }
  await sleep(100);
  await attempt();
  console.log('ledger after full retry with idempotency keys:', ledger.rows, '\n');
}

// 3. Collect outcomes with allSettled, retry only what failed.
{
  const ledger = createLedger();
  ledger.failOnce('w3');
  const first = await Promise.allSettled(ids.map((id) => ledger.write(id)));
  const failedIds = ids.filter((_, i) => first[i].status === 'rejected');
  console.log('failed after first pass:', failedIds);
  await Promise.all(failedIds.map((id) => ledger.write(id)));
  console.log('ledger after retrying only failures:', ledger.rows);
}

// 4. A lost response. The write commits, but the caller only sees a timeout, so a rejected
//    call does not prove the write failed. The lost response is injected, not measured.
console.log('\nSimulated lost response, the write commits but the caller sees a timeout');
for (const useKey of [false, true]) {
  const ledger = createLedger();
  const key = useKey ? 'order-42:w1' : undefined;
  try {
    await ledger.write('w1', key).then(() => { throw new Error('w1 timed out waiting for the response'); });
  } catch (e) {
    console.log(`  attempt 1 rejected (${e.message})`);
  }
  await ledger.write('w1', key); // the caller retries, believing nothing was written
  console.log(`  after a retry ${useKey ? 'with' : 'without'} an idempotency key, ledger =`, ledger.rows);
}
