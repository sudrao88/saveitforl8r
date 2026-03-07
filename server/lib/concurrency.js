/**
 * Simple concurrency limiter for background AI tasks.
 * Prevents unbounded parallel Gemini API calls during traffic surges.
 */

export function createConcurrencyLimiter(maxConcurrent) {
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
   */
  const run = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      tryNext();
    });

  const stats = () => ({ active, queued: queue.length, maxConcurrent });

  return { run, stats };
}
