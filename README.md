# promise-all-rejection-and-cancellation

Reproductions for the article on what happens to the other operations when `Promise.all()` rejects.

Plain Node.js. No dependencies, no network, no servers, no database.

## Requirements

Node.js 22 or newer. The tests and all five scripts were run on Node 22.23.4, 24.22.2 and 26.13.0. No other versions were tested. Node 20 reached end of life on 2026-04-30 and is not supported.

## Run it

```
npm run verify     # tests, then all five scripts
npm run repeat     # run each script 10 times and compare the full output, takes about a minute
npm test           # helper tests only
npm run 01         # one script (01 to 05)
```

Or run a script directly, for example `node 01-lifecycle.mjs`.

## What each script shows

| Script                    | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-lifecycle.mjs`        | The aggregate rejects as soon as one input rejects. The other inputs still settle, and a side effect still happens afterwards. A later value is not reachable through the aggregate.                                                                                                                                                                                                                                                                                |
| `02-later-rejections.mjs` | Later rejections of inputs passed to `Promise.all()` raise no separate `unhandledRejection` event in Node, because `Promise.all()` attached rejection handlers to every input. The already-rejected aggregate does not expose those later outcomes, but the individual promises can still be inspected. A rejection nobody handles does raise the event. Under Node's default `--unhandled-rejections=throw` mode, with no listener installed, it ends the process. |
| `03-combinators.mjs`      | `all`, `allSettled`, `any` and sequential `await` on the same operations. None of the promise combinators cancels anything. Sequential execution only stops later operations from starting.                                                                                                                                                                                                                                                                         |
| `04-cancellation.mjs`     | A shared `AbortController` through `lib/run-all.mjs`. Tasks that honour the signal stop, a task that ignores it keeps going, and giving up the wait is not the same as stopping the work.                                                                                                                                                                                                                                                                           |
| `05-partial-failure.mjs`  | A full retry after partial failure repeats writes that already happened. Idempotency keys and retrying only known failures avoid that. A final scenario injects a lost response, so a write commits while the caller sees a timeout. That case is simulated, not measured.                                                                                                                                                                                          |

## Reading the output

Each line of a timeline starts with elapsed milliseconds. Treat the order of events as the result. The exact milliseconds change from run to run.

## Limits worth knowing

- `runAllOrAbort` requests cancellation. It cannot stop a task that ignores the signal, and it cannot undo work that already finished.
- `whenSettled` resolves only if every started task eventually settles. A task that never settles keeps it pending.
- Tasks that were never invoked because the group had already failed are reported as `not-started`.
- A rejection is labelled abort-induced only when it is the abort reason itself or carries it as its `cause`. An unrelated error that happens to be named `AbortError` is reported as an independent failure.
- The reported failure is the first one the helper observed, which is not necessarily the one that physically happened first.
- `settleTimeoutMs` must be an integer from 1 to 2147483647. Other values throw a `RangeError`, because `setTimeout` coerces delays below 1, `NaN` and oversized delays to 1 ms and truncates fractions. Node prints a warning for some of those values, and which ones depends on the Node version. The value limits how long the helper waits. It is not a real-time deadline.
- `observedAfterAbort` says whether the abort had already happened when the helper saw the task settle. It does not say when the task physically finished.
- Script 05 uses an in-memory ledger. The `Set` of seen keys only lives inside the process. Real idempotency has to be enforced by the service or database that receives the write. A timeout can also reject a call whose write did commit, so retrying only the calls that look failed is safe only when the failure is known to mean the write was not applied.
- Script 04 uses Node's `timers/promises`, which supports `AbortSignal`. Other APIs, including `fetch`, were not tested here.
- `unhandledRejection` is a Node runtime event, not part of the language. Browsers were not tested.
- `lib/run-all.mjs` is a teaching implementation of the pattern, not a general purpose concurrency library.

## License

MIT. See `LICENSE`.
