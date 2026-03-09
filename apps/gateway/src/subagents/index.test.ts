import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { GatewayConfig } from "@aihub/shared";
import { afterEach, describe, expect, it } from "vitest";
import { getSubagentLogs } from "./index.js";

const tmpRoots: string[] = [];

async function setupLogs(lines: Record<string, unknown>[]): Promise<{
  config: GatewayConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-subagents-"));
  tmpRoots.push(root);
  const projectDir = path.join(root, "PRO-1_empty-exec");
  const sessionDir = path.join(projectDir, "sessions", "worker");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, "logs.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8"
  );
  return {
    config: {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tmpRoots
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("getSubagentLogs shell diagnostics", () => {
  it("emits warning event for empty exec result payloads", async () => {
    const { config } = await setupLogs([
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "exec_command",
        args: { cmd: "apm start PRO-1 --template worker" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "exec_command",
        result: { stdout: "", stderr: "", is_error: false },
        isError: false,
      },
    ]);

    const out = await getSubagentLogs(config, "PRO-1", "worker", 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const warning = out.data.events.find((event) => event.type === "warning");
    expect(warning).toBeTruthy();
    expect(warning?.text).toContain(
      "No output captured for shell command: apm start PRO-1 --template worker"
    );
    expect(warning?.text).toContain("command -v apm && apm --version");
  });

  it("does not emit warning event when stdout is present", async () => {
    const { config } = await setupLogs([
      {
        type: "tool_execution_start",
        toolCallId: "t2",
        toolName: "exec_command",
        args: { cmd: "apm --version" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t2",
        toolName: "exec_command",
        result: { stdout: "apm 1.2.3", stderr: "", is_error: false },
        isError: false,
      },
    ]);

    const out = await getSubagentLogs(config, "PRO-1", "worker", 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.events.some((event) => event.type === "warning")).toBe(
      false
    );
  });
});
