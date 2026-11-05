// Runs each experiment several times and compares the complete printed output, in order.
//
// Elapsed milliseconds are replaced by "N ms" because they change from run to run.
// Nothing else is touched. Events are not sorted or deduplicated, so a change in the
// order of events shows up as a different output.
//
// Each run is one real execution of a script, so the default 10 runs per script take
// about a minute. A dot is printed per finished run so you can see it is working.
// A run that takes longer than 30 seconds is killed and reported as a failure.
//
// Usage: node repeat.mjs [runs]   (default 10)
import { spawnSync } from 'node:child_process';

const runs = Number(process.argv[2] ?? 10);
if (!Number.isInteger(runs) || runs < 2) {
  console.error('Usage: node repeat.mjs [runs, an integer of at least 2]');
  process.exit(2);
}

const RUN_TIMEOUT_MS = 30_000;

const scripts = [
  '01-lifecycle.mjs',
  '02-later-rejections.mjs',
  '03-combinators.mjs',
  '04-cancellation.mjs',
  '05-partial-failure.mjs',
];

const normalise = (text) => text.replace(/\b\d+ ms\b/g, 'N ms');

let allStable = true;
console.log(`node ${process.version}, ${runs} runs per script`);

for (const script of scripts) {
  const distinct = new Set();
  let failure = null;
  process.stdout.write(`${script}  `);

  for (let i = 0; i < runs; i += 1) {
    const { status, stdout, error } = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (error || status !== 0) {
      failure = error?.code === 'ETIMEDOUT'
        ? `run ${i + 1} did not finish within ${RUN_TIMEOUT_MS / 1000} s and was killed`
        : `run ${i + 1} exited with code ${status}`;
      break;
    }
    distinct.add(normalise(stdout));
    process.stdout.write('.');
  }

  if (failure) {
    allStable = false;
    console.log(`  FAILED, ${failure}`);
  } else {
    const stable = distinct.size === 1;
    allStable &&= stable;
    console.log(`  ${distinct.size} distinct output${distinct.size === 1 ? '' : 's'}  ${stable ? 'stable' : 'UNSTABLE'}`);
  }
}

process.exit(allStable ? 0 : 1);
