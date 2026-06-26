// Coalesce streaming agent text deltas into a small number of message edits.
//
// The agent emits text in many tiny deltas. Editing a Telegram message on every
// delta (a tight per-token loop, à la Hermes) burns through Telegram's edit
// rate limit and produces visual jitter. Instead we accumulate deltas and only
// surface an edit at a *natural breakpoint* — the end of a paragraph or
// sentence — so the live message grows in readable, settled chunks. A minimum
// interval between edits guards Telegram's per-message edit rate limit during a
// long turn, and a soft size ceiling forces progress even when the model emits
// one long unbroken run of text.
//
// This module is transport-agnostic: it decides *what* the live text should be
// and *when* an edit is due. The handler owns actually sending/editing.

// Telegram does not publish a hard per-message edit limit, but editing the same
// message more than roughly once per second risks 429s on a long turn. A ~1.2s
// floor keeps us comfortably under that while still feeling live.
const DEFAULT_MIN_EDIT_INTERVAL_MS = 1200;

// Force a flush once the un-surfaced tail grows past this many characters, even
// without a natural breakpoint, so a long unbroken sentence still streams.
const DEFAULT_MAX_PENDING_CHARS = 280;

// Don't surface a leading dribble of a few characters; wait until there is
// enough text to be worth showing.
const DEFAULT_MIN_FLUSH_CHARS = 24;

export type StreamCoalescerOptions = {
  /** Minimum wall-clock gap between two surfaced edits (rate-limit guard). */
  minEditIntervalMs?: number;
  /** Force a flush when the un-surfaced tail exceeds this many characters. */
  maxPendingChars?: number;
  /** Smallest amount of new text worth surfacing as the first/next edit. */
  minFlushChars?: number;
  /** Clock source, injectable for tests. Defaults to Date.now. */
  now?: () => number;
};

/**
 * True when `text` ends on a natural breakpoint: a paragraph break, a list/line
 * boundary, or a sentence terminator followed by whitespace. These are the
 * points at which surfacing a partial reply reads as "settled" rather than
 * "mid-word".
 */
export function endsAtBreakpoint(text: string): boolean {
  if (!text) return false;
  // Paragraph or hard line break — the strongest, most common breakpoint.
  if (/\n\s*$/.test(text)) return true;
  // Sentence terminator (., !, ?, …) optionally closed by a quote/bracket and
  // followed by trailing whitespace.
  if (/[.!?…]["'”’)\]]*\s$/.test(text)) return true;
  return false;
}

export type FlushReason = "breakpoint" | "overflow" | "final";

/**
 * Accumulates streaming text deltas and surfaces full-text snapshots only at
 * natural breakpoints, throttled by a minimum edit interval.
 *
 * Usage: call {@link push} for each delta, then {@link takeEdit} to get the
 * snapshot to surface when one is due (or `null` when it isn't). At turn end,
 * call {@link takeFinal} to drain whatever remains regardless of timing.
 */
export class StreamCoalescer {
  private readonly minEditIntervalMs: number;
  private readonly maxPendingChars: number;
  private readonly minFlushChars: number;
  private readonly now: () => number;

  /** Everything received so far. */
  private accumulated = "";
  /** Length of `accumulated` last surfaced via an edit. */
  private surfacedLength = 0;
  /** Timestamp of the last surfaced edit, or null before the first. */
  private lastEditAt: number | null = null;

  constructor(options: StreamCoalescerOptions = {}) {
    this.minEditIntervalMs =
      options.minEditIntervalMs ?? DEFAULT_MIN_EDIT_INTERVAL_MS;
    this.maxPendingChars = options.maxPendingChars ?? DEFAULT_MAX_PENDING_CHARS;
    this.minFlushChars = options.minFlushChars ?? DEFAULT_MIN_FLUSH_CHARS;
    this.now = options.now ?? Date.now;
  }

  /** The full text accumulated so far. */
  get text(): string {
    return this.accumulated;
  }

  /** Characters not yet surfaced through an edit. */
  get pendingLength(): number {
    return this.accumulated.length - this.surfacedLength;
  }

  /** True once at least one snapshot has been surfaced. */
  get hasSurfaced(): boolean {
    return this.lastEditAt !== null;
  }

  /** Append a streaming delta. */
  push(delta: string): void {
    if (delta) this.accumulated += delta;
  }

  /**
   * Return the snapshot to surface if an edit is due, else `null`.
   *
   * An edit is due when there is enough un-surfaced text AND either the tail has
   * overflowed the size ceiling or it ends on a natural breakpoint — but never
   * before the minimum interval has elapsed since the previous edit.
   */
  takeEdit(): { text: string; reason: FlushReason } | null {
    const pending = this.pendingLength;
    if (pending <= 0) return null;

    const overflow = pending >= this.maxPendingChars;

    // Below the minimum, only overflow is allowed to force the first byte out;
    // otherwise wait for more text so we don't surface a tiny dribble.
    if (pending < this.minFlushChars && !overflow) return null;

    if (!this.intervalElapsed()) return null;

    const atBreakpoint = endsAtBreakpoint(this.accumulated);
    if (!atBreakpoint && !overflow) return null;

    return this.surface(overflow ? "overflow" : "breakpoint");
  }

  /**
   * Drain the full accumulated text for the final edit, regardless of interval
   * or breakpoints. Returns `null` only when there is nothing new to surface
   * beyond what was already shown.
   */
  takeFinal(): { text: string; reason: FlushReason } | null {
    if (this.accumulated.length === this.surfacedLength && this.hasSurfaced) {
      return null;
    }
    if (!this.accumulated) return null;
    return this.surface("final");
  }

  private intervalElapsed(): boolean {
    if (this.lastEditAt === null) return true;
    return this.now() - this.lastEditAt >= this.minEditIntervalMs;
  }

  private surface(reason: FlushReason): { text: string; reason: FlushReason } {
    this.surfacedLength = this.accumulated.length;
    this.lastEditAt = this.now();
    return { text: this.accumulated, reason };
  }
}

export {
  DEFAULT_MIN_EDIT_INTERVAL_MS,
  DEFAULT_MAX_PENDING_CHARS,
  DEFAULT_MIN_FLUSH_CHARS,
};
