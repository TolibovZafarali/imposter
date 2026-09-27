import assert from 'node:assert/strict';
import test from 'node:test';

import { startResultReveal } from '../game/resultReveal.ts';

function createClock() {
  let now = 0;
  const jobs = new Set();
  return {
    schedule(callback, delay) {
      const job = { callback, at: now + delay };
      jobs.add(job);
      return () => jobs.delete(job);
    },
    advanceTo(time) {
      for (;;) {
        const next = [...jobs].filter((job) => job.at <= time).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        jobs.delete(next);
        next.callback();
      }
      now = time;
    },
    pending: () => jobs.size,
  };
}

test('keeps identities and the word hidden through the heartbeats, then reveals in order', () => {
  const clock = createClock();
  const events = [];
  startResultReveal({ imposterCount: 1, onEvent: (event) => events.push(event), schedule: clock.schedule });
  clock.advanceTo(1800);
  assert.deepEqual(events.map((event) => event.type), ['beat', 'beat', 'beat']);
  clock.advanceTo(2100);
  assert.equal(events.at(-1).type, 'flip');
  clock.advanceTo(2400);
  assert.deepEqual(events.at(-1), { type: 'names', count: 1 });
  assert.ok(!events.some((event) => event.type === 'word' || event.type === 'complete'));
  clock.advanceTo(2800);
  assert.equal(events.at(-1).type, 'word');
  clock.advanceTo(3000);
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(clock.pending(), 0);
});

test('reveals multiple imposters one at a time before the secret word', () => {
  const clock = createClock();
  const events = [];
  startResultReveal({ imposterCount: 3, onEvent: (event) => events.push(event), schedule: clock.schedule });
  clock.advanceTo(3500);
  assert.deepEqual(events.filter((event) => event.type === 'names').map((event) => event.count), [1, 2, 3]);
  assert.equal(events.at(-1).type, 'word');
  clock.advanceTo(4000);
  assert.equal(events.at(-1).type, 'complete');
});

test('skipping at any stage reveals everything once and cancels later pulses', () => {
  for (const skipAt of [0, 800, 2000, 2400, 2700]) {
    const clock = createClock();
    const events = [];
    const sequence = startResultReveal({ imposterCount: 2, onEvent: (event) => events.push(event), schedule: clock.schedule });
    clock.advanceTo(skipAt);
    sequence.skip();
    const afterSkip = [...events];
    sequence.skip();
    clock.advanceTo(10000);
    assert.deepEqual(events, afterSkip);
    assert.deepEqual(events.slice(-3), [{ type: 'names', count: 2 }, { type: 'word' }, { type: 'complete' }]);
    assert.equal(events.filter((event) => event.type === 'complete').length, 1);
    assert.equal(clock.pending(), 0);
  }
});

test('unmount cancellation stops all pending work and cannot complete later', () => {
  const clock = createClock();
  const events = [];
  const sequence = startResultReveal({ imposterCount: 1, onEvent: (event) => events.push(event), schedule: clock.schedule });
  clock.advanceTo(1000);
  sequence.cancel();
  const before = [...events];
  sequence.skip();
  clock.advanceTo(10000);
  assert.deepEqual(events, before);
  assert.equal(clock.pending(), 0);
});
