import { describe, expect, it, vi } from "vitest";
import { GrammyError, HttpError } from "grammy";
import { isTransientError, withRetry } from "./retry.js";

// Build a GrammyError without hitting the network. grammY's constructor expects
// the method, a raw API response payload, and the request payload.
function grammyError(code: number, retryAfter?: number): GrammyError {
  return new GrammyError(
    "Call to 'sendMessage' failed!",
    {
      ok: false,
      error_code: code,
      description: `error ${code}`,
      parameters: retryAfter ? { retry_after: retryAfter } : undefined,
    },
    "sendMessage",
    {}
  );
}

function httpError(): HttpError {
  return new HttpError(
    "Network request failed",
    new Error("ECONNRESET")
  );
}

const noSleep = () => Promise.resolve();

describe("isTransientError", () => {
  it("treats HttpError (network) as transient", () => {
    expect(isTransientError(httpError())).toBe(true);
  });

  it("treats 429 and 5xx Telegram errors as transient", () => {
    expect(isTransientError(grammyError(429))).toBe(true);
    expect(isTransientError(grammyError(500))).toBe(true);
    expect(isTransientError(grammyError(503))).toBe(true);
  });

  it("treats 4xx Telegram errors as persistent", () => {
    expect(isTransientError(grammyError(400))).toBe(false);
    expect(isTransientError(grammyError(401))).toBe(false);
    expect(isTransientError(grammyError(403))).toBe(false);
  });

  it("treats bare network error codes as transient", () => {
    expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientError({ code: "EAI_AGAIN" })).toBe(true);
  });

  it("treats AbortError as transient", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isTransientError(err)).toBe(true);
  });

  it("treats an ordinary error as persistent", () => {
    expect(isTransientError(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result without retrying on success", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(op, { sleep: noSleep });
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(httpError())
      .mockResolvedValue("ok");
    const result = await withRetry(op, { sleep: noSleep });
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does not retry a persistent failure", async () => {
    const err = grammyError(403);
    const op = vi.fn().mockRejectedValue(err);
    await expect(withRetry(op, { sleep: noSleep })).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("re-throws after exhausting retries", async () => {
    const err = httpError();
    const op = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(op, { maxRetries: 2, sleep: noSleep })
    ).rejects.toBe(err);
    // initial try + 2 retries
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("honours Telegram's retry_after on 429", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(grammyError(429, 3))
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry(op, { sleep, baseDelayMs: 100 });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("backs off exponentially across attempts", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(httpError())
      .mockRejectedValueOnce(httpError())
      .mockResolvedValue("ok");
    const delays: number[] = [];
    const sleep = vi.fn((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });
    // Pin jitter to 0 for deterministic assertions.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    await withRetry(op, { sleep, baseDelayMs: 500 });
    randomSpy.mockRestore();
    expect(delays).toEqual([500, 1000]);
  });
});
