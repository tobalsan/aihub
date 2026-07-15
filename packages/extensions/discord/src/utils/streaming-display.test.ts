import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingDisplay } from "./streaming-display.js";

describe("StreamingDisplay", () => {
  afterEach(() => vi.useRealTimers());

  it("posts on first text, edits the complete reply, and rolls over chunks", async () => {
    const client = { rest: { post: vi.fn().mockResolvedValueOnce({ id: "one" }).mockResolvedValueOnce({ id: "two" }), patch: vi.fn() } };
    const first = vi.fn();
    const display = new StreamingDisplay(client as never, "channel", first, 60_000);
    display.append("hello");
    await display.finalize();
    expect(client.rest.post).toHaveBeenCalledWith("/channels/channel/messages", { body: { content: "hello" } });
    expect(first).toHaveBeenCalledOnce();
    expect(client.rest.patch).toHaveBeenCalledWith("/channels/channel/messages/one", { body: { content: "hello" } });
    display.append("ignored");
  });

  it("throttles edits and posts continuation chunks", async () => {
    vi.useFakeTimers();
    const client = { rest: { post: vi.fn().mockResolvedValueOnce({ id: "one" }).mockResolvedValueOnce({ id: "two" }), patch: vi.fn().mockResolvedValue(undefined) } };
    const display = new StreamingDisplay(client as never, "channel", vi.fn(), 100);

    display.append("first");
    await vi.runAllTimersAsync();
    display.append(" second");
    display.append(" third");
    expect(client.rest.patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(client.rest.patch).toHaveBeenCalledTimes(1);

    display.append("x".repeat(2_000));
    await display.finalize();
    expect(client.rest.post).toHaveBeenCalledTimes(2);
  });

  it("does not post after abort and keeps concurrent displays isolated", async () => {
    const firstClient = { rest: { post: vi.fn().mockResolvedValue({ id: "first" }), patch: vi.fn() } };
    const secondClient = { rest: { post: vi.fn().mockResolvedValue({ id: "second" }), patch: vi.fn() } };
    const first = new StreamingDisplay(firstClient as never, "one", vi.fn());
    const second = new StreamingDisplay(secondClient as never, "two", vi.fn());
    await first.abort();
    first.append("ignored");
    second.append("visible");
    await second.finalize();
    expect(firstClient.rest.post).not.toHaveBeenCalled();
    expect(secondClient.rest.post).toHaveBeenCalledWith("/channels/two/messages", { body: { content: "visible" } });
  });

  it("handles a failed first post and runs failure cleanup", async () => {
    const client = { rest: { post: vi.fn().mockRejectedValue(new Error("Discord unavailable")), patch: vi.fn() } };
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const display = new StreamingDisplay(client as never, "channel", vi.fn(), 60_000, undefined, undefined, cleanup);

    display.append("hello");
    await expect(display.finalize()).rejects.toThrow("Discord unavailable");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
