import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_INTERVAL_MS, TypingKeepAlive } from "./typing.js";

describe("TypingKeepAlive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately on start", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.start();

    expect(send).toHaveBeenCalledTimes(1);
    expect(typing.active).toBe(true);
  });

  it("resolves start() only after the first action is dispatched", async () => {
    let resolveSend: () => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );
    const typing = new TypingKeepAlive(send);

    let settled = false;
    const started = typing.start().then(() => {
      settled = true;
    });

    expect(send).toHaveBeenCalledTimes(1);
    // Not yet settled: the initial typing POST is still in flight.
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSend();
    await started;
    expect(settled).toBe(true);

    typing.stop();
  });

  it("start() resolves even when the first action rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("api down"));
    const typing = new TypingKeepAlive(send);

    await expect(typing.start()).resolves.toBeUndefined();

    typing.stop();
  });

  it("refreshes on the keep-alive cadence while active", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.start();
    expect(send).toHaveBeenCalledTimes(1); // initial

    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(TYPING_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledTimes(5);

    typing.stop();
  });

  it("uses a ~2s default cadence", () => {
    expect(TYPING_INTERVAL_MS).toBe(2000);
  });

  it("honours a custom interval", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send, { intervalMs: 500 });

    typing.start();
    send.mockClear();

    vi.advanceTimersByTime(1500);
    expect(send).toHaveBeenCalledTimes(3);

    typing.stop();
  });

  it("stops the loop promptly on stop (mirrors turn done/error)", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.start();
    send.mockClear();

    typing.stop();
    expect(typing.active).toBe(false);

    vi.advanceTimersByTime(TYPING_INTERVAL_MS * 10);
    expect(send).not.toHaveBeenCalled();
  });

  it("re-triggers typing immediately on poke while active", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.start();
    send.mockClear();

    typing.poke();
    expect(send).toHaveBeenCalledTimes(1);

    typing.stop();
  });

  it("ignores poke when not active", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.poke();
    expect(send).not.toHaveBeenCalled();
  });

  it("is idempotent for start and stop", () => {
    const send = vi.fn();
    const typing = new TypingKeepAlive(send);

    typing.start();
    typing.start(); // no extra immediate fire, no second interval
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TYPING_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);

    typing.stop();
    typing.stop(); // safe to call twice
    expect(typing.active).toBe(false);
  });

  it("swallows async send errors so the loop keeps running", () => {
    const send = vi.fn().mockRejectedValue(new Error("api down"));
    const typing = new TypingKeepAlive(send);

    expect(() => typing.start()).not.toThrow();
    expect(() => vi.advanceTimersByTime(TYPING_INTERVAL_MS)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
    expect(typing.active).toBe(true);

    typing.stop();
  });

  it("swallows synchronous send errors", () => {
    const send = vi.fn(() => {
      throw new Error("boom");
    });
    const typing = new TypingKeepAlive(send);

    expect(() => typing.start()).not.toThrow();
    expect(typing.active).toBe(true);

    typing.stop();
  });
});
