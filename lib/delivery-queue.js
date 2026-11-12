/**
 * Bounded, serialized delivery with a small retry budget.
 *
 * `turn/end` listeners must return quickly. A notification is therefore queued
 * here, and only transient process failures are retried. Deterministic setup
 * failures (a missing helper or unsupported platform) must never loop.
 */

export const DEFAULT_MAX_PENDING = 128;
export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000]);

/** Wait for the next retry, resolving early when the queue is disposed. */
export function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Whether an error describes a transient delivery failure.
 *
 * Node's `execFile` reports a timeout as `killed`/a signal, and a child that
 * ran and failed with a numeric exit status. Its string `code` values such as
 * `EACCES` and this plugin's `HELPER_MISSING` are configuration errors and are
 * not retried.
 * @param {unknown} error - a rejection from the notify function.
 */
export function isRetryableDeliveryError(error) {
  if (typeof error !== 'object' || error === null) return false;
  if (error.killed === true) return true;
  return Number.isSafeInteger(error.code);
}

/**
 * Create one serialized delivery queue.
 *
 * @param {object} [options]
 * @param {number} [options.maxPending] - queued (not running) notifications allowed.
 * @param {number[]} [options.retryDelaysMs] - delays after each retryable failure;
 *   the array length is the retry budget (defaults to three retries: 1/2/4s).
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep] -
 *   injectable timer for tests.
 * @param {(event: { reason: string }) => void} [options.onDrop] - notification
 *   skipped because the queue is full.
 * @param {(event: { attempt: number }) => void} [options.onRetry] - optional
 *   retry counter hook; callers should not log user content here.
 */
export function createDeliveryQueue(options = {}) {
  const maxPending = Number.isSafeInteger(options.maxPending) && options.maxPending > 0
    ? options.maxPending
    : DEFAULT_MAX_PENDING;
  const retryDelaysMs = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.filter((value) => Number.isFinite(value) && value >= 0)
    : [...DEFAULT_RETRY_DELAYS_MS];
  const sleep = options.sleep ?? delay;
  const onDrop = options.onDrop ?? (() => {});
  const onRetry = options.onRetry ?? (() => {});
  const controller = new AbortController();
  const pending = [];
  const pendingKeys = new Set();
  let active;
  let disposed = false;

  function safely(callback, value) {
    try {
      callback(value);
    } catch (_error) {
      // A diagnostic hook must never break delivery or leak into the queue.
    }
  }

  async function run(item) {
    let attempts = 0;
    try {
      while (!disposed) {
        attempts += 1;
        try {
          await item.task();
          return;
        } catch (error) {
          if (disposed) return;
          const retryIndex = attempts - 1;
          if (!isRetryableDeliveryError(error) || retryIndex >= retryDelaysMs.length) {
            safely(item.onFailure, { error, attempts });
            return;
          }
          safely(onRetry, { attempt: attempts });
          try {
            await sleep(retryDelaysMs[retryIndex], controller.signal);
          } catch (_error) {
            return;
          }
        }
      }
    } finally {
      active = undefined;
      pump();
    }
  }

  function pump() {
    if (disposed || active !== undefined || pending.length === 0) return;
    const item = pending.shift();
    pendingKeys.delete(item.key);
    active = item;
    void run(item);
  }

  /**
   * Queue one task. A key already queued or running is ignored, so a duplicate
   * `turn/end` cannot create a second system notification.
   * @returns {boolean} whether the task was queued.
   */
  function enqueue(key, task, handlers = {}) {
    if (disposed) return false;
    if (active?.key === key || pendingKeys.has(key)) return false;
    if (pending.length >= maxPending) {
      safely(onDrop, { reason: 'queue-full' });
      return false;
    }
    pending.push({
      key,
      task,
      onFailure: handlers.onFailure,
    });
    pendingKeys.add(key);
    pump();
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    pending.length = 0;
    pendingKeys.clear();
  }

  return {
    enqueue,
    dispose,
    get active() {
      return active !== undefined;
    },
    get size() {
      return pending.length + (active === undefined ? 0 : 1);
    },
  };
}
