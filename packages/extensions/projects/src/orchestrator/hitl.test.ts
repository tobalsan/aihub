import { describe, expect, it } from "vitest";
import { createHitlBurstBuffer } from "./hitl.js";

describe("HITL burst buffer", () => {
  it("sends 3 events in one batched notification", async () => {
    const messages: string[] = [];
    const hitl = createHitlBurstBuffer({
      notify: (message) => messages.push(message),
    });

    hitl.add({
      kind: "reviewer_fail",
      projectId: "PRO-1",
      sliceId: "PRO-1-S01",
      summary: "Reviewer returned the slice to todo.",
    });
    hitl.add({
      kind: "stall",
      projectId: "PRO-1",
      sliceId: "PRO-1-S02",
      summary: "Slice has no live run.",
    });
    hitl.add({
      kind: "merger_conflict",
      projectId: "PRO-2",
      sliceId: "PRO-2-S01",
      summary: "Conflict needs human.",
    });

    await hitl.flush();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("HITL check-in");
    expect(messages[0]).toContain("PRO-1:");
    expect(messages[0]).toContain(
      "- [reviewer_fail] PRO-1-S01: Reviewer returned the slice to todo."
    );
    expect(messages[0]).toContain("- [stall] PRO-1-S02: Slice has no live run.");
    expect(messages[0]).toContain("PRO-2:");
    expect(messages[0]).toContain(
      "- [merger_conflict] PRO-2-S01: Conflict needs human."
    );
  });

  it("flushes at cap and leaves trailing events for the next notification", async () => {
    const messages: string[] = [];
    const hitl = createHitlBurstBuffer({
      notify: (message) => messages.push(message),
      cap: 5,
    });

    for (let i = 1; i <= 6; i += 1) {
      hitl.add({
        kind: "stall",
        projectId: "PRO-1",
        sliceId: `PRO-1-S0${i}`,
        summary: `event ${i}`,
      });
    }
    await hitl.flush();

    expect(messages).toHaveLength(2);
    expect(messages[0]?.match(/^- \[stall]/gm)).toHaveLength(5);
    expect(messages[1]).toContain("event 6");
  });

  it("flushes when the window timer fires", async () => {
    let callback: (() => void) | undefined;
    const messages: string[] = [];
    const hitl = createHitlBurstBuffer({
      notify: (message) => messages.push(message),
      setTimer: (cb) => {
        callback = cb;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    });

    hitl.add({
      kind: "stall",
      projectId: "PRO-1",
      sliceId: "PRO-1-S01",
      summary: "event 1",
    });

    callback?.();
    await Promise.resolve();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("event 1");
  });

  it("does not notify for an empty window", async () => {
    const messages: string[] = [];
    const hitl = createHitlBurstBuffer({
      notify: (message) => messages.push(message),
    });

    await hitl.flush();

    expect(messages).toEqual([]);
  });
});
