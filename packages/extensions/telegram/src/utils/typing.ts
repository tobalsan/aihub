// Telegram's typing bubble ("...") expires after ~5s and is cleared whenever a
// message is delivered to the chat. To keep the agent feeling alive for the full
// duration of a turn we re-send the "typing" chat action on a ~2s cadence and
// re-trigger it after every intermediate message send.
const TYPING_INTERVAL_MS = 2000;

export type SendTyping = () => Promise<void> | void;

export type TypingKeepAliveOptions = {
  intervalMs?: number;
};

/**
 * Drives a Telegram typing indicator for the lifetime of a single agent turn.
 *
 * - `start()` sends an immediate typing action and begins a keep-alive loop that
 *   refreshes it on a fixed cadence so the bubble never lapses during a long turn.
 *   It resolves once that first action has been dispatched, so the caller can
 *   await it to guarantee the indicator precedes the turn's first reply.
 * - `poke()` re-triggers typing immediately (used after each intermediate send,
 *   since delivering a message clears Telegram's typing bubble).
 * - `stop()` halts the loop promptly; it is safe to call on turn done or error
 *   and is idempotent.
 */
export class TypingKeepAlive {
  private readonly send: SendTyping;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(send: SendTyping, options: TypingKeepAliveOptions = {}) {
    this.send = send;
    this.intervalMs = options.intervalMs ?? TYPING_INTERVAL_MS;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    // Await the first action so the bubble is dispatched before the turn's first
    // reply. On a fast (warm) turn the run completes before the keep-alive
    // interval ever fires, so this initial send is the only thing that makes the
    // indicator appear; dispatching it up front keeps it from racing the reply.
    const first = this.fire();
    this.timer = setInterval(() => this.fire(), this.intervalMs);
    return first;
  }

  /** Re-trigger typing immediately (e.g. after an intermediate send). */
  poke(): void {
    if (!this.timer) return;
    this.fire();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private fire(): Promise<void> {
    try {
      const result = this.send();
      if (result instanceof Promise) {
        // Typing is best-effort; ignore transient API errors but let callers
        // await dispatch so the first action can precede the reply.
        return result.catch(() => {});
      }
    } catch {
      // Typing is best-effort; ignore synchronous errors.
    }
    return Promise.resolve();
  }
}

export { TYPING_INTERVAL_MS };
