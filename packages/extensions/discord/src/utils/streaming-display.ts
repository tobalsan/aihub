import type { CarbonClient } from "../client.js";
import { splitMessage } from "./chunk.js";

export const DISCORD_STREAM_UPDATE_INTERVAL_MS = 1500;

/** Owns the post/edit lifecycle for one agent invocation. */
export class StreamingDisplay {
  private text = "";
  private messages: Array<{ id: string; content: string }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private renderChain: Promise<void> = Promise.resolve();
  private rendering = false;
  private closed = false;

  constructor(
    private readonly client: CarbonClient,
    private readonly channelId: string,
    private readonly onFirstPost: () => Promise<void>,
    private readonly intervalMs = DISCORD_STREAM_UPDATE_INTERVAL_MS,
    private readonly replyTo?: { messageId: string; mode: "off" | "all" | "first" },
    private readonly beforeFirstPost?: () => Promise<void>,
    private readonly onRenderError?: () => Promise<void>
  ) {}

  append(text: string): void {
    if (this.closed || !text) return;
    this.text += text;
    if (!this.messages.length && !this.rendering) {
      void this.enqueueRender().catch(() => {});
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.enqueueRender().catch(() => {});
      }, this.intervalMs);
    }
  }

  async finalize(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.enqueueRender(true);
  }

  async abort(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.renderChain;
  }

  private enqueueRender(force = false): Promise<void> {
    if (!this.rendering) {
      this.rendering = true;
      this.renderChain = this.render(force)
        .catch(async (error) => {
          await this.onRenderError?.();
          throw error;
        })
        .finally(() => { this.rendering = false; });
    } else {
      this.renderChain = this.renderChain.then(() => this.enqueueRender(force));
    }
    return this.renderChain;
  }

  private async render(force = false): Promise<void> {
    this.timer = undefined;
    if (!this.text) return;
    const chunks = splitMessage(this.text);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      const existing = this.messages[index];
      if (!existing) {
        if (this.messages.length === 0) await this.beforeFirstPost?.();
        const created = await this.client.rest.post(`/channels/${this.channelId}/messages`, {
          body: {
            content: chunk,
            ...(this.replyTo && (this.replyTo.mode === "all" || (this.replyTo.mode === "first" && index === 0))
              ? { message_reference: { message_id: this.replyTo.messageId } }
              : {}),
          },
        }) as { id: string };
        this.messages.push({ id: created?.id ?? "", content: chunk });
        if (this.messages.length === 1) await this.onFirstPost();
      } else if (existing.id && (force || existing.content !== chunk)) {
        await this.client.rest.patch(`/channels/${this.channelId}/messages/${existing.id}`, {
          body: { content: chunk },
        });
        existing.content = chunk;
      }
    }
  }
}
