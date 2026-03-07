/**
 * Simple concurrency limiter for background AI tasks.
 * Prevents unbounded parallel Gemini API calls during traffic surges.
 */

const DEFAULT_MAX_QUEUE_SIZE = 100;

export function createConcurrencyLimiter(maxConcurrent, maxQueueSize = DEFAULT_MAX_QUEUE_SIZE) {
  let active = 0;
  const queue = [];

  const tryNext = () => {
    while (queue.length > 0 && active < maxConcurrent) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          tryNext();
        });
    }
  };

  /**
   * Run an async function respecting the concurrency limit.
   * If at capacity, the call is queued and will execute when a slot opens.
   * Rejects immediately if the queue is full to prevent memory exhaustion.
   */
  const run = (fn) =>
    new Promise((resolve, reject) => {
      if (queue.length >= maxQueueSize) {
        reject(new Error(`Queue full (${maxQueueSize}). Try again later.`));
        return;
      }
      queue.push({ fn, resolve, reject });
      tryNext();
    });

  const stats = () => ({ active, queued: queue.length, maxConcurrent, maxQueueSize });

  return { run, stats };
}
