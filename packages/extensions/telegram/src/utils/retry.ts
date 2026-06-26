import { GrammyError, HttpError } from "grammy";

// Transient send failures (network blips, Telegram 5xx, rate limits) should not
// surface as a hard error on the first try. We retry a small number of times
// with exponential backoff so a brief hiccup self-heals instead of dropping the
// message or the turn.
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;

export type RetryOptions = {
  /** Number of retry attempts after the initial try. */
  maxRetries?: number;
  /** Base delay for exponential backoff. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay. */
  maxDelayMs?: number;
  /** Log prefix for retry/failure diagnostics, e.g. `[telegram:agentId]`. */
  logPrefix?: string;
  /** Label for the operation being retried, used in logs. */
  label?: string;
  /** Sleep function, overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Classify an error as transient (worth retrying) vs. persistent (fatal).
 *
 * - `HttpError`: grammY's wrapper for network-level failures reaching Telegram
 *   (DNS, connection reset, timeout). Always transient.
 * - `GrammyError`: a Telegram API error response. 429 (rate limited) and 5xx
 *   (server-side) are transient; 4xx (bad request, unauthorized, blocked) are
 *   persistent and must not be retried.
 * - Bare network errors (e.g. AbortError, ECONNRESET) that slipped through.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof HttpError) return true;
  if (err instanceof GrammyError) {
    return err.error_code === 429 || err.error_code >= 500;
  }
  const code = (err as { code?: string } | undefined)?.code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED"
  ) {
    return true;
  }
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  return false;
}

/**
 * If Telegram returns a 429, it tells us exactly how long to wait via
 * `retry_after` (seconds). Honour it rather than guessing with backoff.
 */
function retryAfterMs(err: unknown): number | undefined {
  if (err instanceof GrammyError) {
    const seconds = err.parameters?.retry_after;
    if (typeof seconds === "number" && seconds > 0) {
      return seconds * 1000;
    }
  }
  return undefined;
}

/**
 * Run an async operation, retrying transient failures with exponential backoff
 * (plus jitter). Persistent errors throw immediately. The final failure after
 * exhausting retries is re-thrown so callers still see it.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const prefix = options.logPrefix ?? "[telegram]";
  const label = options.label ?? "operation";

  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      if (!isTransientError(err) || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      const backoff = Math.min(
        baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs
      );
      const jitter = Math.floor(Math.random() * (backoff / 2));
      const delay = retryAfterMs(err) ?? backoff + jitter;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `${prefix} Transient ${label} failure (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${reason}`
      );
      await sleep(delay);
    }
  }
}

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
};
