import type { CarbonClient } from "../client.js";

/** Best-effort acknowledgement for one accepted user message. */
export class AckReaction {
  private active = false;

  constructor(
    private readonly client: CarbonClient,
    private readonly channelId: string,
    private readonly messageId: string,
    private readonly emoji: string
  ) {}

  async add(): Promise<void> {
    try {
      await this.client.rest.put(
        `/channels/${this.channelId}/messages/${this.messageId}/reactions/${encodeURIComponent(this.emoji)}/@me`
      );
      this.active = true;
    } catch {
      // Reactions are presentation only.
    }
  }

  async remove(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    try {
      await this.client.rest.delete(
        `/channels/${this.channelId}/messages/${this.messageId}/reactions/${encodeURIComponent(this.emoji)}/@me`
      );
    } catch {
      // Reactions are presentation only.
    }
  }
}
