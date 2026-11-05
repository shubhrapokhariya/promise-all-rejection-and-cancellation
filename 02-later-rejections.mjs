// Cases C and D: later rejections and multiple failures.
//
// Node's process-level 'unhandledRejection' event is a RUNTIME feature (the host's
// implementation of HostPromiseRejectionTracker). It is observed here, kept
// separate from the language-level behaviour.
import { spawnSync } from 'node:child_process';
import { createTimeline, sleep } from './lib/timeline.mjs';

const { log } = createTimeline();
const reports = [];
process.on('unhandledRejection', (reason) => {
  reports.push(reason.message);
  log(`process 'unhandledRejection' event for "${reason.message}"`);
});

const rejectAfter = (name, ms) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(name)), ms));

// --- Scenario 1: three inputs all reject, passed to Promise.all ------------------
console.log('Scenario 1: P1, P2, P3 reject at 20/60/90 ms; all passed to Promise.all');
const p1 = rejectAfter('P1', 20);
const p2 = rejectAfter('P2', 60);
const p3 = rejectAfter('P3', 90);

Promise.all([p1, p2, p3]).catch((e) => log(`aggregate rejected with "${e.message}"`));

await sleep(250);
console.log(`unhandledRejection events in scenario 1: ${reports.length}`);

// What the caller can still learn, and from where:
const outcomes = await Promise.allSettled([p1, p2, p3]);
console.log('Outcomes read from the individual promises afterwards:');
for (const [i, o] of outcomes.entries()) {
  console.log(`  P${i + 1}: ${o.status}${o.reason ? ` (${o.reason.message})` : ''}`);
}

// --- Scenario 2 (control): a rejecting promise nobody handles --------------------
console.log('\nScenario 2 (control): one rejecting promise that is NOT passed to anything');
reports.length = 0;
rejectAfter('LONE', 20);
await sleep(150);
console.log(`unhandledRejection events in scenario 2: ${reports.length}`);

// --- Scenario 3: Promise.allSettled collects every outcome up front --------------
console.log('\nScenario 3: same shape of failures, collected with Promise.allSettled');
const q = [rejectAfter('Q1', 20), rejectAfter('Q2', 60), rejectAfter('Q3', 90)];
const settled = await Promise.allSettled(q);
log('allSettled fulfilled');
for (const [i, o] of settled.entries()) {
  console.log(`  Q${i + 1}: ${o.status} (${o.reason.message})`);
}

// --- Scenario 4: Node's default behaviour --------------------------------------------
// The scenarios above install an 'unhandledRejection' listener, so they observe the event
// instead of showing what Node does by default. Each case below runs in its own process
// with no listener.
console.log("\nScenario 4: default behaviour in a separate process, with no 'unhandledRejection' listener");
const rejectAfterSource = 'const rej = (ms, m) => new Promise((_, r) => setTimeout(r, ms, new Error(m)));';
const runChild = (label, code) => {
  const { status } = spawnSync(process.execPath, ['-e', `${rejectAfterSource} ${code}`], { stdio: 'ignore' });
  console.log(`  ${label} -> exit code ${status}`);
};
runChild('one rejection nobody handles', "rej(20, 'lone');");
runChild('Promise.all, a later input rejects', "Promise.all([rej(20, 'a'), rej(60, 'b')]).catch(() => {});");
