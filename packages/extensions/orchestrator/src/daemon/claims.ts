export type ClaimState = { issueId: string; runId: string; claimedAt: string; lastEventAt: string };

export class ClaimsRegistry {
  private claims = new Map<string, ClaimState>();
  private lock: Promise<void> = Promise.resolve();

  async tryClaim(issueId: string, runId: string): Promise<ClaimState | undefined> {
    let release!: () => void;
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      if (this.claims.has(issueId)) return undefined;
      const now = new Date().toISOString();
      const claim = { issueId, runId, claimedAt: now, lastEventAt: now };
      this.claims.set(issueId, claim);
      return claim;
    } finally {
      release();
    }
  }

  release(issueId: string): boolean {
    return this.claims.delete(issueId);
  }

  get(issueId: string): ClaimState | undefined {
    return this.claims.get(issueId);
  }

  list(): ClaimState[] {
    return [...this.claims.values()];
  }

  touch(issueId: string, at = new Date().toISOString()): void {
    const claim = this.claims.get(issueId);
    if (claim) claim.lastEventAt = at;
  }
}
