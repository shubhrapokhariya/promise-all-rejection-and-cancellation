// Cases A and B, plus the side-effect question.
//
//   A  rejects at ~50 ms          (early rejection)
//   B  fulfils at ~150 ms         (later success, pure value, no side effect)
//   C  writes to a store at ~250 ms, then fulfils (side effect after the aggregate rejected)
//
// Observers attached to the individual promises only record WHEN each one
// settles. Promise.all has already attached its own handlers to each input.
import { createTimeline, sleep } from './lib/timeline.mjs';

const { log } = createTimeline();
const store = []; // stands in for "something outside the promise" (a file, a row, a message)

function start(name, ms, behaviour) {
  log(`${name} started`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (behaviour === 'reject') {
        reject(new Error(`${name} failed`));
      } else if (behaviour === 'write') {
        store.push(name);
        log(`${name} side effect performed (store = [${store}])`);
        resolve(`${name} result`);
      } else {
        resolve(`${name} result`);
      }
    }, ms);
  });
}

const a = start('A', 50, 'reject');
const b = start('B', 150, 'value');
const c = start('C', 250, 'write');

for (const [name, p] of [['A', a], ['B', b], ['C', c]]) {
  p.then(
    (v) => log(`${name} promise fulfilled with "${v}"`),
    (e) => log(`${name} promise rejected with "${e.message}"`),
  );
}

const aggregate = Promise.all([a, b, c]);
let aggregateOutcome = 'pending';
aggregate.then(
  (v) => { aggregateOutcome = 'fulfilled'; log('AGGREGATE fulfilled'); },
  (e) => { aggregateOutcome = `rejected (${e.message})`; log(`AGGREGATE rejected with "${e.message}"`); },
);

await sleep(400);

console.log('\n--- after 400 ms ---');
console.log('aggregate:', aggregateOutcome);
console.log('store:', JSON.stringify(store));
const aReason = await a.catch((e) => e);
const aggregateReason = await aggregate.catch((e) => e);
console.log('aggregate rejected with the very same error object as A:', aggregateReason === aReason);
console.log('B value, read from the individual promise b:', await b);
