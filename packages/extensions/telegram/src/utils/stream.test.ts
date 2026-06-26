import { describe, expect, it } from "vitest";
import {
  StreamCoalescer,
  endsAtBreakpoint,
  DEFAULT_MAX_PENDING_CHARS,
} from "./stream.js";

/**
 * A controllable clock so interval gating is deterministic. `tick(ms)` advances
 * the fake time the coalescer reads via its injected `now`.
 */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

describe("endsAtBreakpoint", () => {
  it("treats a trailing newline as a breakpoint", () => {
    expect(endsAtBreakpoint("a paragraph\n")).toBe(true);
    expect(endsAtBreakpoint("a paragraph\n\n")).toBe(true);
  });

  it("treats a sentence terminator + whitespace as a breakpoint", () => {
    expect(endsAtBreakpoint("Done. ")).toBe(true);
    expect(endsAtBreakpoint("Really? ")).toBe(true);
    expect(endsAtBreakpoint("Wow! ")).toBe(true);
    expect(endsAtBreakpoint("Wait…\t")).toBe(true);
    expect(endsAtBreakpoint('He said "hi." ')).toBe(true);
  });

  it("does not break mid-word or mid-sentence", () => {
    expect(endsAtBreakpoint("partial wor")).toBe(false);
    expect(endsAtBreakpoint("a sentence with no terminator")).toBe(false);
    expect(endsAtBreakpoint("3.14")).toBe(false); // decimal, not a sentence end
    expect(endsAtBreakpoint("")).toBe(false);
  });
});

describe("StreamCoalescer", () => {
  it("does not surface before there is enough text", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now, minFlushChars: 24 });
    c.push("short. "); // ends at a breakpoint but is below minFlushChars
    expect(c.takeEdit()).toBeNull();
  });

  it("surfaces a full snapshot at a natural breakpoint", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now });
    c.push("Here is a first complete sentence");
    expect(c.takeEdit()).toBeNull(); // no breakpoint yet
    c.push(". ");
    const edit = c.takeEdit();
    expect(edit).toEqual({
      text: "Here is a first complete sentence. ",
      reason: "breakpoint",
    });
  });

  it("throttles edits to the minimum interval", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now, minEditIntervalMs: 1000 });

    c.push("First sentence is long enough. ");
    expect(c.takeEdit()?.reason).toBe("breakpoint");

    // A second breakpoint arrives immediately — too soon to surface.
    c.push("Second sentence also arrives. ");
    expect(c.takeEdit()).toBeNull();

    // After the interval elapses it is allowed through.
    clock.tick(1000);
    const edit = c.takeEdit();
    expect(edit?.text).toBe(
      "First sentence is long enough. Second sentence also arrives. "
    );
    expect(edit?.reason).toBe("breakpoint");
  });

  it("forces an overflow flush for a long unbroken run with no breakpoint", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now });
    const run = "x".repeat(DEFAULT_MAX_PENDING_CHARS + 5); // no breakpoint
    c.push(run);
    const edit = c.takeEdit();
    expect(edit?.reason).toBe("overflow");
    expect(edit?.text).toBe(run);
  });

  it("produces a coalesced edit sequence from a token stream", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now, minEditIntervalMs: 1000 });
    // Simulate the agent emitting many small deltas across three sentences.
    const deltas = [
      "The ", "quick ", "brown ", "fox. ", // sentence 1 -> breakpoint
      "Jumps ", "over ", "the ", "lazy ", "dog. ", // sentence 2 -> throttled
      "And ", "then ", "rests.\n", // sentence 3 -> after interval
    ];
    const surfaced: string[] = [];
    for (const d of deltas) {
      c.push(d);
      const edit = c.takeEdit();
      if (edit) surfaced.push(edit.text);
      clock.tick(400); // ~time between deltas
    }
    const finalEdit = c.takeFinal();
    if (finalEdit) surfaced.push(finalEdit.text);

    // Far fewer edits than deltas: coalesced at breakpoints, throttled by interval.
    expect(surfaced.length).toBeLessThan(deltas.length);
    // The last surfaced snapshot is the full accumulated text.
    expect(surfaced[surfaced.length - 1]).toBe(
      "The quick brown fox. Jumps over the lazy dog. And then rests.\n"
    );
    // Each snapshot is a growing prefix of the final text (monotonic growth).
    for (let i = 1; i < surfaced.length; i++) {
      expect(surfaced[i].startsWith(surfaced[i - 1])).toBe(true);
      expect(surfaced[i].length).toBeGreaterThan(surfaced[i - 1].length);
    }
  });

  it("takeFinal drains remaining text regardless of interval or breakpoint", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now, minEditIntervalMs: 5000 });
    c.push("A complete sentence here. ");
    expect(c.takeEdit()?.reason).toBe("breakpoint");
    c.push("trailing words with no terminator and no time");
    // takeEdit would be blocked (interval not elapsed, no breakpoint)...
    expect(c.takeEdit()).toBeNull();
    // ...but the final drain surfaces everything.
    const finalEdit = c.takeFinal();
    expect(finalEdit?.reason).toBe("final");
    expect(finalEdit?.text).toBe(
      "A complete sentence here. trailing words with no terminator and no time"
    );
  });

  it("takeFinal returns null when nothing new remains after surfacing", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now });
    c.push("Everything has already been shown. ");
    expect(c.takeEdit()).not.toBeNull();
    expect(c.takeFinal()).toBeNull();
  });

  it("takeFinal surfaces text even when nothing was streamed live", () => {
    const clock = fakeClock();
    const c = new StreamCoalescer({ now: clock.now });
    c.push("tiny"); // below minFlushChars, never surfaced live
    expect(c.takeEdit()).toBeNull();
    expect(c.takeFinal()).toEqual({ text: "tiny", reason: "final" });
  });
});
