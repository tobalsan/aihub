import { describe, expect, it, vi } from "vitest";
import { logError } from "./logging.js";

describe("logError", () => {
  it("always emits one JSON line for circular and non-string values", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const error = Object.assign(new Error("failed\nrequest"), {
      status: 502n,
      endpoint: circular,
      details: () => "details",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    logError("tool failed", error, { circular });

    expect(consoleError).toHaveBeenCalledOnce();
    const line = consoleError.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      msg: "tool failed",
      status: "502",
      details: "\"() => \\\"details\\\"\"",
      message: "failed\nrequest",
    });
  });
});
