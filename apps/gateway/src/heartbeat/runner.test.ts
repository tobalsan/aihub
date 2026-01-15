import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseDurationMs,
  stripHeartbeatToken,
  containsHeartbeatToken,
  evaluateHeartbeatReply,
  isHeartbeatEnabled,
  getHeartbeatIntervalMs,
  loadHeartbeatPrompt,
  DEFAULT_HEARTBEAT_PROMPT,
} from "./runner.js";
import type { AgentConfig, HeartbeatConfig } from "@aihub/shared";

// Helper to create minimal agent config for testing
function createAgent(heartbeat?: HeartbeatConfig): AgentConfig {
  return {
    id: "test-agent",
    name: "Test Agent",
    workspace: "~/test",
    model: { model: "test-model" },
    queueMode: "queue",
    heartbeat,
  };
}

describe("parseDurationMs", () => {
  describe("valid durations", () => {
    it("parses plain number as minutes (default)", () => {
      expect(parseDurationMs("5")).toBe(5 * 60 * 1000);
      expect(parseDurationMs("30")).toBe(30 * 60 * 1000);
      expect(parseDurationMs("1")).toBe(60 * 1000);
    });

    it("parses minutes with unit", () => {
      expect(parseDurationMs("5m")).toBe(5 * 60 * 1000);
      expect(parseDurationMs("30min")).toBe(30 * 60 * 1000);
      expect(parseDurationMs("1m")).toBe(60 * 1000);
    });

    it("parses hours", () => {
      expect(parseDurationMs("1h")).toBe(60 * 60 * 1000);
      expect(parseDurationMs("2hr")).toBe(2 * 60 * 60 * 1000);
      expect(parseDurationMs("24h")).toBe(24 * 60 * 60 * 1000);
    });

    it("parses seconds", () => {
      expect(parseDurationMs("30s")).toBe(30 * 1000);
      expect(parseDurationMs("60sec")).toBe(60 * 1000);
    });

    it("handles whitespace", () => {
      expect(parseDurationMs("  5m  ")).toBe(5 * 60 * 1000);
      expect(parseDurationMs(" 1h ")).toBe(60 * 60 * 1000);
    });

    it("handles case insensitivity", () => {
      expect(parseDurationMs("5M")).toBe(5 * 60 * 1000);
      expect(parseDurationMs("1H")).toBe(60 * 60 * 1000);
      expect(parseDurationMs("30S")).toBe(30 * 1000);
    });

    it("respects defaultUnit option", () => {
      expect(parseDurationMs("5", { defaultUnit: "h" })).toBe(5 * 60 * 60 * 1000);
      expect(parseDurationMs("30", { defaultUnit: "s" })).toBe(30 * 1000);
    });
  });

  describe("disabled values", () => {
    it("returns null for zero", () => {
      expect(parseDurationMs("0")).toBeNull();
      expect(parseDurationMs("0m")).toBeNull();
      expect(parseDurationMs("0h")).toBeNull();
      expect(parseDurationMs("0s")).toBeNull();
    });
  });

  describe("invalid values", () => {
    it("returns null for undefined", () => {
      expect(parseDurationMs(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseDurationMs("")).toBeNull();
      expect(parseDurationMs("   ")).toBeNull();
    });

    it("returns null for invalid format", () => {
      expect(parseDurationMs("abc")).toBeNull();
      expect(parseDurationMs("5x")).toBeNull();
      expect(parseDurationMs("-5m")).toBeNull();
    });
  });
});

describe("stripHeartbeatToken", () => {
  describe("plain token", () => {
    it("strips plain HEARTBEAT_OK", () => {
      expect(stripHeartbeatToken("HEARTBEAT_OK")).toBe("");
      expect(stripHeartbeatToken("  HEARTBEAT_OK  ")).toBe("");
    });

    it("strips case-insensitive variants", () => {
      expect(stripHeartbeatToken("heartbeat_ok")).toBe("");
      expect(stripHeartbeatToken("Heartbeat_OK")).toBe("");
      expect(stripHeartbeatToken("HEARTBEAT_ok")).toBe("");
    });

    it("strips token from middle of text", () => {
      expect(stripHeartbeatToken("All good! HEARTBEAT_OK - nothing to report")).toBe(
        "All good!  - nothing to report"
      );
    });

    it("strips token from start of text", () => {
      expect(stripHeartbeatToken("HEARTBEAT_OK - nothing to report")).toBe(
        "- nothing to report"
      );
    });

    it("strips token from end of text", () => {
      expect(stripHeartbeatToken("All good! HEARTBEAT_OK")).toBe("All good!");
    });
  });

  describe("HTML wrapped tokens", () => {
    it("strips <b> wrapped token", () => {
      expect(stripHeartbeatToken("<b>HEARTBEAT_OK</b>")).toBe("");
      expect(stripHeartbeatToken("All good! <b>HEARTBEAT_OK</b>")).toBe("All good!");
    });

    it("strips <strong> wrapped token", () => {
      expect(stripHeartbeatToken("<strong>HEARTBEAT_OK</strong>")).toBe("");
      expect(stripHeartbeatToken("Status: <strong>HEARTBEAT_OK</strong> done")).toBe(
        "Status:  done"
      );
    });

    it("strips <em> wrapped token", () => {
      expect(stripHeartbeatToken("<em>HEARTBEAT_OK</em>")).toBe("");
    });

    it("strips <i> wrapped token", () => {
      expect(stripHeartbeatToken("<i>HEARTBEAT_OK</i>")).toBe("");
    });

    it("strips <code> wrapped token", () => {
      expect(stripHeartbeatToken("<code>HEARTBEAT_OK</code>")).toBe("");
    });

    it("strips <span> wrapped token", () => {
      expect(stripHeartbeatToken('<span class="status">HEARTBEAT_OK</span>')).toBe("");
    });
  });

  describe("Markdown wrapped tokens", () => {
    it("strips ** wrapped token (bold)", () => {
      expect(stripHeartbeatToken("**HEARTBEAT_OK**")).toBe("");
      expect(stripHeartbeatToken("All good! **HEARTBEAT_OK**")).toBe("All good!");
    });

    it("strips * wrapped token (italic)", () => {
      expect(stripHeartbeatToken("*HEARTBEAT_OK*")).toBe("");
    });

    // Note: underscore-wrapped tokens (_HEARTBEAT_OK_) are not stripped because
    // underscore is a word character and would cause issues with variable names
    // like MY_HEARTBEAT_OK_VALUE. This is an acceptable limitation since models
    // typically use * for markdown emphasis, not underscore.
    it("does not strip underscore-wrapped tokens (word boundary limitation)", () => {
      expect(stripHeartbeatToken("_HEARTBEAT_OK_")).toBe("_HEARTBEAT_OK_");
      expect(stripHeartbeatToken("__HEARTBEAT_OK__")).toBe("__HEARTBEAT_OK__");
    });
  });

  describe("preserves surrounding content", () => {
    it("preserves text before and after token", () => {
      expect(
        stripHeartbeatToken("I checked everything. HEARTBEAT_OK. Will continue monitoring.")
      ).toBe("I checked everything. . Will continue monitoring.");
    });

    it("handles multiple tokens", () => {
      expect(
        stripHeartbeatToken("HEARTBEAT_OK - HEARTBEAT_OK")
      ).toBe("-");
    });

    it("does not strip partial matches", () => {
      expect(stripHeartbeatToken("HEARTBEAT_OKAY")).toBe("HEARTBEAT_OKAY");
      expect(stripHeartbeatToken("XHEARTBEAT_OK")).toBe("XHEARTBEAT_OK");
      // Word boundaries: underscore is a word character, so _HEARTBEAT_OK_ won't match
      expect(stripHeartbeatToken("MY_HEARTBEAT_OK_VALUE")).toBe("MY_HEARTBEAT_OK_VALUE");
    });
  });
});

describe("containsHeartbeatToken", () => {
  it("returns true for plain token", () => {
    expect(containsHeartbeatToken("HEARTBEAT_OK")).toBe(true);
    expect(containsHeartbeatToken("Status: HEARTBEAT_OK")).toBe(true);
  });

  it("returns true for wrapped tokens", () => {
    expect(containsHeartbeatToken("**HEARTBEAT_OK**")).toBe(true);
    expect(containsHeartbeatToken("<b>HEARTBEAT_OK</b>")).toBe(true);
  });

  it("returns false for no token", () => {
    expect(containsHeartbeatToken("Everything is fine")).toBe(false);
    expect(containsHeartbeatToken("")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(containsHeartbeatToken("heartbeat_ok")).toBe(true);
    expect(containsHeartbeatToken("Heartbeat_Ok")).toBe(true);
  });
});

describe("evaluateHeartbeatReply", () => {
  const DEFAULT_ACK_MAX_CHARS = 300;

  describe("empty replies", () => {
    it("returns ok-empty for undefined reply", () => {
      const result = evaluateHeartbeatReply(undefined, DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-empty");
      expect(result.shouldDeliver).toBe(false);
      expect(result.strippedText).toBe("");
    });

    it("returns ok-empty for empty string", () => {
      const result = evaluateHeartbeatReply("", DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-empty");
      expect(result.shouldDeliver).toBe(false);
    });

    it("returns ok-empty for whitespace-only", () => {
      const result = evaluateHeartbeatReply("   \n\t  ", DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-empty");
      expect(result.shouldDeliver).toBe(false);
    });
  });

  describe("token-only replies", () => {
    it("returns ok-token for plain HEARTBEAT_OK", () => {
      const result = evaluateHeartbeatReply("HEARTBEAT_OK", DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-token");
      expect(result.shouldDeliver).toBe(false);
      expect(result.strippedText).toBe("");
    });

    it("returns ok-token for wrapped HEARTBEAT_OK", () => {
      const result = evaluateHeartbeatReply("**HEARTBEAT_OK**", DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-token");
      expect(result.shouldDeliver).toBe(false);
    });

    it("returns ok-token when remaining text is within threshold", () => {
      const result = evaluateHeartbeatReply("HEARTBEAT_OK - All good!", DEFAULT_ACK_MAX_CHARS);
      expect(result.status).toBe("ok-token");
      expect(result.shouldDeliver).toBe(false);
      expect(result.strippedText).toBe("- All good!");
    });
  });

  describe("alert replies", () => {
    it("returns sent for text without token", () => {
      const result = evaluateHeartbeatReply(
        "Hey! I noticed something you should know about.",
        DEFAULT_ACK_MAX_CHARS
      );
      expect(result.status).toBe("sent");
      expect(result.shouldDeliver).toBe(true);
      expect(result.strippedText).toBe("Hey! I noticed something you should know about.");
    });

    it("returns sent when stripped text exceeds ackMaxChars", () => {
      const longText = "A".repeat(350);
      const result = evaluateHeartbeatReply(
        `HEARTBEAT_OK ${longText}`,
        DEFAULT_ACK_MAX_CHARS
      );
      expect(result.status).toBe("sent");
      expect(result.shouldDeliver).toBe(true);
      expect(result.strippedText.length).toBeGreaterThan(DEFAULT_ACK_MAX_CHARS);
    });
  });

  describe("ackMaxChars threshold", () => {
    it("respects custom threshold", () => {
      const text = "HEARTBEAT_OK - Short note";

      // With high threshold, should not deliver
      const result1 = evaluateHeartbeatReply(text, 100);
      expect(result1.shouldDeliver).toBe(false);

      // With low threshold, should deliver
      const result2 = evaluateHeartbeatReply(text, 5);
      expect(result2.shouldDeliver).toBe(true);
    });

    it("threshold of 0 delivers any non-empty text with token", () => {
      const result = evaluateHeartbeatReply("HEARTBEAT_OK a", 0);
      expect(result.shouldDeliver).toBe(true);
    });
  });
});

describe("isHeartbeatEnabled", () => {
  it("returns false when no heartbeat config", () => {
    const agent = createAgent(undefined);
    expect(isHeartbeatEnabled(agent)).toBe(false);
  });

  it("returns true for empty heartbeat config (uses defaults)", () => {
    const agent = createAgent({});
    expect(isHeartbeatEnabled(agent)).toBe(true);
  });

  it("returns true for heartbeat with valid interval", () => {
    const agent = createAgent({ every: "30m" });
    expect(isHeartbeatEnabled(agent)).toBe(true);
  });

  it("returns false for heartbeat disabled with 0", () => {
    const agent = createAgent({ every: "0" });
    expect(isHeartbeatEnabled(agent)).toBe(false);
  });

  it("returns false for heartbeat disabled with 0m", () => {
    const agent = createAgent({ every: "0m" });
    expect(isHeartbeatEnabled(agent)).toBe(false);
  });
});

describe("getHeartbeatIntervalMs", () => {
  it("returns null when heartbeat disabled", () => {
    const agent = createAgent(undefined);
    expect(getHeartbeatIntervalMs(agent)).toBeNull();
  });

  it("returns default 30m when heartbeat enabled without interval", () => {
    const agent = createAgent({});
    expect(getHeartbeatIntervalMs(agent)).toBe(30 * 60 * 1000);
  });

  it("returns configured interval", () => {
    const agent = createAgent({ every: "1h" });
    expect(getHeartbeatIntervalMs(agent)).toBe(60 * 60 * 1000);
  });

  it("returns null for invalid interval", () => {
    const agent = createAgent({ every: "invalid" });
    expect(getHeartbeatIntervalMs(agent)).toBeNull();
  });
});

describe("loadHeartbeatPrompt", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createAgentWithWorkspace(heartbeat?: HeartbeatConfig): AgentConfig {
    return {
      id: "test-agent",
      name: "Test Agent",
      workspace: tmpDir,
      model: { model: "test-model" },
      queueMode: "queue",
      heartbeat,
    };
  }

  describe("config prompt (priority 1)", () => {
    it("uses config prompt when set", async () => {
      const customPrompt = "Check on critical systems every hour.";
      const agent = createAgentWithWorkspace({ prompt: customPrompt });
      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(customPrompt);
    });

    it("uses config prompt even when HEARTBEAT.md exists", async () => {
      const customPrompt = "Use this config prompt";
      const agent = createAgentWithWorkspace({ prompt: customPrompt });

      // Create HEARTBEAT.md in workspace (should be ignored)
      await fs.writeFile(
        path.join(tmpDir, "HEARTBEAT.md"),
        "# This should be ignored\nFile prompt content here."
      );

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(customPrompt);
    });
  });

  describe("HEARTBEAT.md file (priority 2)", () => {
    it("reads HEARTBEAT.md when config prompt is not set", async () => {
      const agent = createAgentWithWorkspace({});
      const fileContent = "# Daily Check\nReview dashboards and report anomalies.";

      await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), fileContent);

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(fileContent);
    });

    it("trims whitespace from HEARTBEAT.md content", async () => {
      const agent = createAgentWithWorkspace({});
      const fileContent = "\n\n  Check systems daily.  \n\n";

      await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), fileContent);

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe("Check systems daily.");
    });

    it("falls back to default when HEARTBEAT.md is empty", async () => {
      const agent = createAgentWithWorkspace({});

      await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "   \n\n   ");

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });

    it("falls back to default when HEARTBEAT.md is whitespace only", async () => {
      const agent = createAgentWithWorkspace({});

      await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "");

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });
  });

  describe("default prompt (priority 3)", () => {
    it("uses default when no config prompt and no HEARTBEAT.md", async () => {
      const agent = createAgentWithWorkspace({});

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });

    it("uses default when heartbeat config is undefined", async () => {
      const agent = createAgentWithWorkspace(undefined);

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });
  });

  describe("error handling", () => {
    it("does not crash when HEARTBEAT.md is missing", async () => {
      const agent = createAgentWithWorkspace({});
      // No HEARTBEAT.md file exists

      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });

    it("does not crash when workspace directory does not exist", async () => {
      const agent: AgentConfig = {
        id: "test-agent",
        name: "Test Agent",
        workspace: "/nonexistent/path/that/does/not/exist",
        model: { model: "test-model" },
        queueMode: "queue",
        heartbeat: {},
      };

      // Should not throw, should return default
      const result = await loadHeartbeatPrompt(agent);
      expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
    });

    it("falls back to default when HEARTBEAT.md has read permission issues", async () => {
      // Skip on Windows where chmod may not work as expected
      if (process.platform === "win32") {
        return;
      }

      const agent = createAgentWithWorkspace({});
      const heartbeatPath = path.join(tmpDir, "HEARTBEAT.md");

      await fs.writeFile(heartbeatPath, "Secret content");
      await fs.chmod(heartbeatPath, 0o000); // Remove all permissions

      try {
        const result = await loadHeartbeatPrompt(agent);
        expect(result).toBe(DEFAULT_HEARTBEAT_PROMPT);
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(heartbeatPath, 0o644);
      }
    });
  });
});
