import { describe, expect, it, vi } from "vitest";
import { AckReaction } from "./ack-reaction.js";

describe("AckReaction", () => {
  it("adds then removes an acknowledgement, tolerating API failures", async () => {
    const client = { rest: { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) } };
    const ack = new AckReaction(client as never, "channel", "message", "👀");
    await ack.add();
    await ack.remove();
    expect(client.rest.put).toHaveBeenCalledWith("/channels/channel/messages/message/reactions/%F0%9F%91%80/@me");
    expect(client.rest.delete).toHaveBeenCalledOnce();
  });
});
