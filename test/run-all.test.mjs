import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { runAllOrAbort, GroupFailedError, SiblingFailedError } from '../lib/run-all.mjs';

const never = () => new Promise(() => {});
const LIMIT = { timeout: 2000 }; // a hang fails the test instead of stalling the suite

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the group to fail');
}

test('returns every value in input order when all tasks succeed', LIMIT, async () => {
  const values = await runAllOrAbort([
    async () => { await sleep(20); return 'a'; },
    async () => 'b',
  ]);
  assert.deepEqual(values, ['a', 'b']);
});

test('returns an empty array for an empty task list', LIMIT, async () => {
  assert.deepEqual(await runAllOrAbort([]), []);
});

test('does not abort the signal when every task succeeds', LIMIT, async () => {
  let seen;
  await runAllOrAbort([(signal) => { seen = signal; return 'ok'; }]);
  assert.equal(seen.aborted, false);
});

test('aborts the shared signal on failure and keeps the original error as the cause', LIMIT, async () => {
  const boom = new Error('boom');
  let seen;
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw boom; },
    (signal) => { seen = signal; return sleep(500, 'x', { signal }); },
  ]));
  assert.ok(error instanceof GroupFailedError);
  assert.equal(error.cause, boom);
  assert.equal(seen.aborted, true);
  assert.ok(seen.reason instanceof SiblingFailedError);
  assert.equal(seen.reason.cause, boom);
});

test('reports abort-induced rejections as such, not as independent failures', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('boom'); },
    (signal) => sleep(500, 'x', { signal }), // Node API that wraps signal.reason in an AbortError
  ]));
  assert.equal(error.timedOut, false);
  assert.equal(error.outcomes[1].status, 'rejected');
  assert.equal(error.outcomes[1].abortInduced, true);
  assert.equal(error.outcomes[0].abortInduced, false);
});

test('treats a rejection with signal.reason itself as abort-induced', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('boom'); },
    (signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]));
  assert.equal(error.outcomes[1].abortInduced, true);
});

test('does not treat an independent AbortError as abort-induced', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('primary failure'); },
    async () => { await sleep(30); throw new DOMException('independent failure', 'AbortError'); }, // ignores the signal
  ]));
  assert.equal(error.cause.message, 'primary failure');
  assert.equal(error.outcomes[1].status, 'rejected');
  assert.equal(error.outcomes[1].abortInduced, false);
});

test('observedAfterAbort reflects when settlement was observed, not when the task finished', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    () => 'finished synchronously',
    () => { throw new Error('sync failure'); },
  ]));
  assert.equal(error.outcomes[0].status, 'fulfilled');
  assert.equal(error.outcomes[0].observedAfterAbort, true);
});

test('rejects tasks that are not functions with a TypeError before starting anything', LIMIT, async () => {
  let invoked = false;
  await assert.rejects(
    runAllOrAbort([() => { invoked = true; }, Promise.resolve(1)]),
    TypeError,
  );
  assert.equal(invoked, false);
  await assert.rejects(runAllOrAbort('not an array'), TypeError);
});

test('rejects a sparse task list instead of returning a result with a hole', LIMIT, async () => {
  let invoked = false;
  const sparse = [() => { invoked = true; }, , () => 3];
  await assert.rejects(runAllOrAbort(sparse), TypeError);
  assert.equal(invoked, false);
});

const activeTimers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

test('leaves no timer behind after the group fails', LIMIT, async () => {
  const before = activeTimers();
  await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('boom'); },
    (signal) => sleep(500, 'x', { signal }),
  ])); // the default 5000 ms deadline must be cleared, or it would keep the process alive
  assert.equal(activeTimers(), before);
});

test('rejects invalid settleTimeoutMs values before starting any task', LIMIT, async () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 31, '100']) {
    let invoked = false;
    await assert.rejects(
      runAllOrAbort([() => { invoked = true; }], { settleTimeoutMs: bad }),
      RangeError,
    );
    assert.equal(invoked, false);
  }
});

test('accepts the boundary values 1 and 2147483647', LIMIT, async () => {
  assert.deepEqual(await runAllOrAbort([() => 'ok'], { settleTimeoutMs: 1 }), ['ok']);
  assert.deepEqual(await runAllOrAbort([() => 'ok'], { settleTimeoutMs: 2 ** 31 - 1 }), ['ok']);
});

test('keeps the first genuine failure when a second task also fails', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('first'); },
    async () => { await sleep(30); throw new Error('second'); }, // ignores the signal
  ]));
  assert.equal(error.cause.message, 'first');
  assert.equal(error.outcomes[1].status, 'rejected');
  assert.equal(error.outcomes[1].reason.message, 'second');
  assert.equal(error.outcomes[1].abortInduced, false);
});

test('a synchronous throw is not missed and the timeout still applies', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort(
    [never, () => { throw new Error('sync fail'); }],
    { settleTimeoutMs: 20 },
  ));
  assert.equal(error.cause.message, 'sync fail');
  assert.equal(error.timedOut, true);
  assert.equal(error.outcomes[0].status, 'pending');
});

test('a task that has started and never settles is reported pending after the timeout', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort(
    [async () => { await sleep(10); throw new Error('boom'); }, never],
    { settleTimeoutMs: 30 },
  ));
  assert.equal(error.timedOut, true);
  assert.equal(error.outcomes[1].status, 'pending');
});

test('tasks after a synchronous failure are not invoked', LIMIT, async () => {
  let invoked = false;
  const error = await failureOf(runAllOrAbort([
    () => { throw new Error('sync fail'); },
    () => { invoked = true; return 'late'; },
  ]));
  assert.equal(invoked, false);
  assert.equal(error.outcomes[1].status, 'not-started');
});

test('a task that ignores the signal stays pending, then shows up in whenSettled', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort(
    [
      async () => { await sleep(10); throw new Error('boom'); },
      async () => { await sleep(120); return 'late'; }, // ignores the signal
    ],
    { settleTimeoutMs: 30 },
  ));
  assert.equal(error.timedOut, true);
  assert.equal(error.outcomes[1].status, 'pending');

  const final = await error.whenSettled;
  assert.equal(final[1].status, 'fulfilled');
  assert.equal(final[1].value, 'late');
  assert.equal(final[1].observedAfterAbort, true);
  assert.equal(error.outcomes[1].status, 'pending'); // the snapshot taken at throw time must not change
});

test('waits for cooperative tasks and reports no timeout when they stop in time', LIMIT, async () => {
  const error = await failureOf(runAllOrAbort([
    async () => { await sleep(10); throw new Error('boom'); },
    (signal) => sleep(500, 'x', { signal }),
  ]));
  assert.equal(error.timedOut, false);
  assert.equal(error.outcomes.every((o) => o.status === 'rejected'), true);
});
