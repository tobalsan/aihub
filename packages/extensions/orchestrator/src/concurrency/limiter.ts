export type Reservation = { ok: true; release: () => void };
export type Rejection = { ok: false; reason: "cap" | "issue-busy" };

export class ConcurrencyLimiter {
  private active = new Set<string>();

  constructor(private readonly maxConcurrent = 3) {}

  tryReserve(input: { issueId: string; profile?: string; repo?: string | null }): Reservation | Rejection {
    if (this.active.has(input.issueId)) return { ok: false, reason: "issue-busy" };
    if (this.active.size >= this.maxConcurrent) return { ok: false, reason: "cap" };
    this.active.add(input.issueId);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(input.issueId);
      },
    };
  }

  count(): number {
    return this.active.size;
  }
}
