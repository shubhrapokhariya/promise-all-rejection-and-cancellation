// A tiny event log. Timestamps are milliseconds since the timeline was created.
// Only the ORDER of events is a claim; exact milliseconds vary between runs.
export function createTimeline() {
  const t0 = performance.now();
  const events = [];
  const log = (label) => {
    const t = Math.round(performance.now() - t0);
    events.push({ t, label });
    console.log(`${String(t).padStart(5)} ms  ${label}`);
  };
  return { log, events };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
