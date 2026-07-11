import { describe, expect, it } from "vitest";
import { IrcLoopGuard } from "./loop-guard.js";
import { isAddressed, normalizeIrcText, parseIrcLine, splitIrcText, toPlainIrcText } from "./protocol.js";
describe("IRC protocol helpers", () => {
  it("parses messages and rejects malformed prefixes", () => { expect(parseIrcLine(":nick!u@h PRIVMSG #room :hello")).toMatchObject({ prefix: "nick!u@h", command: "PRIVMSG", params: ["#room"], trailing: "hello" }); expect(parseIrcLine(": PRIVMSG #room :bad")).toBeNull(); });
  it("handles case-insensitive addressing and ACTION text", () => { expect(isAddressed("AiHuB: hello", "aihub")).toEqual({ addressed: true, text: "hello" }); expect(normalizeIrcText("\u0001ACTION waves\u0001")).toBe("* waves"); });
  it("splits Unicode without exceeding byte limits", () => { const chunks = splitIrcText("🙂🙂🙂", 5); expect(chunks).toEqual(["🙂", "🙂", "🙂"]); expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 5)).toBe(true); });
  it("removes IRC controls and markdown formatting from replies", () => { expect(toPlainIrcText("**hello** \u0002world\u000f\u0001DCC SEND\u0001")).toBe("hello worldDCC SEND"); });
});
describe("A2A loop guard", () => { it("caps per channel, resets only configured humans, and excludes DMs", () => { const guard = new IrcLoopGuard(1, ["Alice"]); expect(guard.allow("#one", "bot")).toBe(true); expect(guard.allow("#one", "bot")).toBe(false); expect(guard.allow("#two", "bot")).toBe(true); expect(guard.allow("#one", "ALICE")).toBe(true); expect(guard.allow("#one", "bot")).toBe(true); expect(guard.allow("#one", "bot", true)).toBe(true); }); });
