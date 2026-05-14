import { describe, expect, it } from "vitest";
import { LeadSessionChangedEventSchema, LeadSessionSchema } from "./types.js";

describe("LeadSessionSchema", () => {
  it("parses the lead session contract", () => {
    const parsed = LeadSessionSchema.parse({
      id: "lead:PRO-1:abc",
      projectId: "PRO-1",
      sliceId: "PRO-1-S01",
      agentId: "pom",
      kind: "lead",
      title: "New session",
      titleLocked: false,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      transcriptRef: "abc",
    });

    expect(parsed.kind).toBe("lead");
    expect(parsed.sliceId).toBe("PRO-1-S01");
  });

  it("parses websocket change events", () => {
    const parsed = LeadSessionChangedEventSchema.parse({
      type: "lead_session_changed",
      kind: "created",
      session: {
        id: "lead:PRO-1:abc",
        projectId: "PRO-1",
        agentId: "pom",
        kind: "lead",
        title: "Main",
        titleLocked: true,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        transcriptRef: "abc",
      },
    });

    expect(parsed.type).toBe("lead_session_changed");
  });
});
