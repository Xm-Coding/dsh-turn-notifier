import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryQueue, isRetryableDeliveryError } from '../lib/delivery-queue.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('condition did not settle');
}

function transientError() {
  return Object.assign(new Error('child exited'), { code: 1 });
}

test('retryable failures use 1/2/4s backoff and stop after success', async () => {
  const sleeps = [];
  let attempts = 0;
  const queue = createDeliveryQueue({
    retryDelaysMs: [1, 2, 4],
    sleep: async (ms) => { sleeps.push(ms); },
  });

  queue.enqueue('turn-1', async () => {
    attempts += 1;
    if (attempts < 4) throw transientError();
  });

  await until(() => attempts === 4 && queue.size === 0);
  assert.deepEqual(sleeps, [1, 2, 4]);
  queue.dispose();
});

test('a transient failure exhausts the retry budget and reports once', async () => {
  let attempts = 0;
  const failures = [];
  const queue = createDeliveryQueue({
    retryDelaysMs: [1, 2, 4],
    sleep: async () => {},
  });

  queue.enqueue('turn-1', async () => {
    attempts += 1;
    throw transientError();
  }, {
    onFailure: ({ error, attempts: finalAttempts }) => failures.push([error.code, finalAttempts]),
  });

  await until(() => failures.length === 1);
  assert.equal(attempts, 4);
  assert.deepEqual(failures, [[1, 4]]);
  queue.dispose();
});

test('deterministic setup failures are not retried', async () => {
  let attempts = 0;
  const sleeps = [];
  const failures = [];
  const queue = createDeliveryQueue({
    retryDelaysMs: [1, 2, 4],
    sleep: async (ms) => { sleeps.push(ms); },
  });

  queue.enqueue('turn-1', async () => {
    attempts += 1;
    throw Object.assign(new Error('helper missing'), { code: 'HELPER_MISSING' });
  }, {
    onFailure: ({ attempts: finalAttempts }) => failures.push(finalAttempts),
  });

  await until(() => failures.length === 1);
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(failures, [1]);
  assert.equal(isRetryableDeliveryError({ code: 'UNSUPPORTED_PLATFORM' }), false);
  assert.equal(isRetryableDeliveryError({ killed: true }), true);
  queue.dispose();
});

test('disposing during backoff cancels the retry timer', async () => {
  const sleeping = deferred();
  let release;
  let attempts = 0;
  let failures = 0;
  const queue = createDeliveryQueue({
    retryDelaysMs: [10],
    sleep: () => {
      sleeping.resolve();
      return new Promise((resolve) => { release = resolve; });
    },
  });

  queue.enqueue('turn-1', async () => {
    attempts += 1;
    throw transientError();
  }, {
    onFailure: () => { failures += 1; },
  });

  await sleeping.promise;
  queue.dispose();
  release();
  await tick();
  await tick();

  assert.equal(attempts, 1);
  assert.equal(failures, 0);
  assert.equal(queue.size, 0);
});

test('the pending queue is bounded and drops excess work with a reason', async () => {
  const gate = deferred();
  const drops = [];
  let calls = 0;
  const queue = createDeliveryQueue({
    maxPending: 1,
    onDrop: (event) => drops.push(event.reason),
  });

  assert.equal(queue.enqueue('turn-1', () => gate.promise), true);
  assert.equal(queue.enqueue('turn-2', async () => { calls += 1; }), true);
  assert.equal(queue.enqueue('turn-3', async () => { calls += 1; }), false);
  assert.deepEqual(drops, ['queue-full']);

  gate.resolve();
  await until(() => queue.size === 0);
  assert.equal(calls, 1);
  queue.dispose();
});

test('the same delivery key is never queued twice', async () => {
  const gate = deferred();
  let calls = 0;
  const queue = createDeliveryQueue();

  assert.equal(queue.enqueue('turn-1', () => gate.promise), true);
  assert.equal(queue.enqueue('turn-1', async () => { calls += 1; }), false);
  gate.resolve();
  await until(() => queue.size === 0);
  assert.equal(calls, 0);
  queue.dispose();
});
