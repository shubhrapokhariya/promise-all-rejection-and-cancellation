// runAllOrAbort: run tasks concurrently with one shared AbortSignal.
//
// On the first observed genuine failure it requests cancellation, then waits (up to
// settleTimeoutMs) for the tasks that already started to settle. It reports what each
// task did and separates real failures from rejections caused by our own abort.
//
// What it does NOT do:
//   - guarantee that any task stopped. A task that ignores the signal keeps running,
//     and is reported as "pending" if it had not settled in time.
//   - undo work that already completed. There is no rollback.
//   - guarantee that `whenSettled` ever resolves. A task that never settles keeps it pending.
//
// Outcome statuses: 'not-started' | 'pending' | 'fulfilled' | 'rejected'
//
// "First" means the first failure whose rejection this helper observed. When several tasks
// fail close together, that is not necessarily the one that physically failed first.
//
// settleTimeoutMs must be an integer from 1 to 2147483647. Anything else throws a
// RangeError, because setTimeout coerces delays below 1, NaN and delays above 2147483647
// to 1 ms and truncates fractions. Node prints a warning for some of those values, and
// which ones depends on the Node version. The value limits how long the helper waits.
// It is not a real-time deadline, because timers do not fire at exact times.
//
// tasks must be an array of functions. A function starts its work when the helper calls
// it, which is what lets the helper skip work after a failure. A promise has already
// started, so it cannot be skipped or given the signal.
//
// observedAfterAbort records whether the abort had already happened when the helper
// observed the task settle. It does not say when the task physically finished, so a task
// that finished earlier can still be observed after the abort.

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export class SiblingFailedError extends Error {
  constructor(cause) {
    super('Aborted because another task in the group failed', { cause });
    this.name = 'SiblingFailedError';
  }
}

export class GroupFailedError extends Error {
  constructor(cause, { outcomes, timedOut, whenSettled }) {
    super('A task in the group failed', { cause });
    this.name = 'GroupFailedError';
    this.outcomes = outcomes;       // snapshot taken when the helper stopped waiting
    this.timedOut = timedOut;       // true if some started task had not settled in time
    this.whenSettled = whenSettled; // resolves with final outcomes once every started task settles
  }
}

// A rejection counts as caused by our abort only when it is tied to the abort reason.
// Cancellable APIs do this in one of two ways. Some reject with signal.reason itself
// (fetch), and some wrap it as the `cause` of an AbortError (timers, fs, events).
// The name "AbortError" alone is not evidence, because a task can fail independently
// with an error of that name.
const isAbortInduced = (reason, signal) =>
  signal.aborted && (reason === signal.reason || reason?.cause === signal.reason);

export async function runAllOrAbort(tasks, { settleTimeoutMs = 5000 } = {}) {
  // findIndex visits holes in a sparse array, which some() and map() skip
  if (!Array.isArray(tasks) || tasks.findIndex((task) => typeof task !== 'function') !== -1) {
    throw new TypeError('runAllOrAbort expects an array of functions that start the work when called, not promises');
  }
  if (!Number.isInteger(settleTimeoutMs) || settleTimeoutMs < 1 || settleTimeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`settleTimeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}, received ${settleTimeoutMs}`);
  }

  const controller = new AbortController();
  const { signal } = controller;
  const outcomes = tasks.map(() => ({ status: 'not-started' }));
  const snapshot = () => outcomes.map((o) => ({ ...o }));

  let firstFailure = null;
  let markFailed;
  const failed = new Promise((resolve) => { markFailed = resolve; });

  // Tasks are invoked synchronously, in order. If one throws synchronously, the group is
  // aborted before the next task is invoked, so later tasks are skipped, not started.
  // The `failed` promise is created first, so a failure at any point cannot be missed.
  const running = tasks.map(async (task, i) => {
    if (signal.aborted) return;
    outcomes[i] = { status: 'pending' };
    try {
      const value = await task(signal);
      outcomes[i] = { status: 'fulfilled', value, observedAfterAbort: signal.aborted };
    } catch (reason) {
      const abortInduced = isAbortInduced(reason, signal);
      outcomes[i] = { status: 'rejected', reason, abortInduced, observedAfterAbort: signal.aborted };
      if (!abortInduced && !firstFailure) {
        firstFailure = { reason };
        controller.abort(new SiblingFailedError(reason));
        markFailed();
      }
    }
  });

  // Every entry in `running` handles its own errors, so this promise never rejects.
  const allSettled = Promise.all(running).then(() => 'settled');

  await Promise.race([allSettled, failed]);
  if (!firstFailure) return outcomes.map((o) => o.value);

  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, settleTimeoutMs, 'timeout'); });
  const result = await Promise.race([allSettled, deadline]);
  clearTimeout(timer);

  throw new GroupFailedError(firstFailure.reason, {
    outcomes: snapshot(),
    timedOut: result === 'timeout',
    whenSettled: allSettled.then(snapshot),
  });
}
