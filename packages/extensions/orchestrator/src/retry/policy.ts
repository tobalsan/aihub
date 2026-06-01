export type RetryKind = "dispatch" | "tool_call";

type Bucket = { failures: number; nextAttempt: number };

export class RetryPolicy {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly now = () => Date.now()) {}

  private key(issueId: string, kind: RetryKind): string {
    return `${issueId}:${kind}`;
  }

  register(issueId: string, kind: RetryKind): Bucket {
    const key = this.key(issueId, kind);
    const previous = this.buckets.get(key)?.failures ?? 0;
    const failures = previous + 1;
    const delayMs = Math.min(30 * 60_000, 30_000 * 2 ** (failures - 1));
    const bucket = { failures, nextAttempt: this.now() + delayMs };
    this.buckets.set(key, bucket);
    return bucket;
  }

  nextAttempt(issueId: string, kind: RetryKind): number | undefined {
    return this.buckets.get(this.key(issueId, kind))?.nextAttempt;
  }

  reset(issueId: string, kind: RetryKind): void {
    this.buckets.delete(this.key(issueId, kind));
  }
}
