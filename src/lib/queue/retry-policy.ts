/**
 * Retry policy — SRS §8.
 *
 * "Suggested policy: 5–8 attempts, exponential delay with jitter, capped
 * around 15–30 minutes, followed by a terminal failure/dead-letter state."
 *
 * This module is pure so the policy can be tested directly, without a queue.
 */
export const MAX_ATTEMPTS = 6;

/** Delay before the first retry. */
const BASE_DELAY_MS = 5_000;

/** Ceiling on any single retry delay (SRS: "capped around 15–30 minutes"). */
export const MAX_DELAY_MS = 20 * 60 * 1000;

/**
 * Full-jitter exponential backoff.
 *
 * The delay is a uniform random point in `[base, exponential]` rather than the
 * exponential value itself. Without jitter, a provider-wide throttle causes
 * every queued job to retry at the same instant and re-trigger the throttle —
 * the thundering herd the jitter exists to break up.
 *
 * `random` is injectable so tests can assert the bounds deterministically.
 */
export function backoffDelayMs(
  attemptsMade: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    BASE_DELAY_MS * 2 ** Math.max(0, attemptsMade - 1),
    MAX_DELAY_MS,
  );

  const jittered = BASE_DELAY_MS + random() * (exponential - BASE_DELAY_MS);
  return Math.round(Math.min(jittered, MAX_DELAY_MS));
}

/** Total worst-case time across every retry, for documentation and tests. */
export function worstCaseTotalDelayMs(): number {
  let total = 0;
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    total += backoffDelayMs(attempt, () => 1);
  }
  return total;
}
