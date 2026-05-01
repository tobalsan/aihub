import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSubagentLogs, listSubagentRuns } from "./runtime.js";

let tempDir: string;

const runtimeOptions = () => ({
  dataDir: tempDir,
  emit: () => undefined,
});

async function writeRun(
  runId: string,
  lines: string[],
  progress?: { latestOutput?: string },
  configOverrides: Record<string, unknown> = {},
  stateOverrides: Record<string, unknown> = {}
) {
  const runDir = path.join(tempDir, "sessions", "subagents", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "config.json"),
    JSON.stringify({
      id: runId,
      label: "Worker",
      cli: "codex",
      cwd: tempDir,
      prompt: "test",
      createdAt: "2026-04-27T00:00:00.000Z",
      archived: false,
      ...configOverrides,
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(runDir, "state.json"),
    JSON.stringify({
      startedAt: "2026-04-27T00:00:00.000Z",
      status: "done",
      exitCode: 0,
      ...stateOverrides,
    }),
    "utf8"
  );
  if (progress) {
    await fs.writeFile(
      path.join(runDir, "progress.json"),
      JSON.stringify(progress),
      "utf8"
    );
  }
  await fs.writeFile(path.join(runDir, "logs.jsonl"), lines.join("\n"), "utf8");
}

describe("subagent runtime logs", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-subagents-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("hides Codex runtime lifecycle and internal stderr noise", async () => {
    await writeRun("run-1", [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "stderr",
        text: "2026-04-27T00:00:00Z WARN codex_features: unknown feature key in config: skills",
      }),
      JSON.stringify({
        type: "stderr",
        text: "2026-04-27T00:00:00Z ERROR codex_core::session: failed to record rollout items",
      }),
      JSON.stringify({
        type: "item.started",
        item: { type: "collab_tool_call", status: "in_progress" },
      }),
      JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "echo ok",
          status: "in_progress",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "echo ok",
          status: "completed",
          exit_code: 0,
          aggregated_output: "ok",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Done." },
      }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
      JSON.stringify({ type: "stderr", text: "actual failure" }),
    ]);

    const logs = await getSubagentLogs(runtimeOptions(), "run-1", 0);

    expect(logs.events.map((event) => event.text)).toEqual([
      JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "echo ok",
          status: "in_progress",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "echo ok",
          status: "completed",
          exit_code: 0,
          aggregated_output: "ok",
        },
      }),
      "Done.",
      "actual failure",
    ]);
  });

  it("ignores hidden runtime events when deriving latest output", async () => {
    await writeRun(
      "run-1",
      [
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Useful result." },
        }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
        JSON.stringify({
          type: "stderr",
          text: "2026-04-27T00:00:00Z WARN codex_core_plugins::manifest: ignored",
        }),
      ],
      {
        latestOutput:
          "2026-04-27T00:00:00Z ERROR codex_core::session: failed to record rollout items",
      }
    );

    const runs = await listSubagentRuns(runtimeOptions());

    expect(runs[0]?.latestOutput).toBe("Useful result.");
  });

  it("filters runs by canonical cwd", async () => {
    const realDir = await fs.mkdtemp(path.join(tempDir, "real-"));
    const linkDir = path.join(tempDir, "link");
    const otherDir = await fs.mkdtemp(path.join(tempDir, "other-"));
    await fs.symlink(realDir, linkDir);
    await writeRun("run-match", [], undefined, { cwd: linkDir });
    await writeRun("run-other", [], undefined, { cwd: otherDir });

    const runs = await listSubagentRuns(runtimeOptions(), { cwd: realDir });

    expect(runs.map((run) => run.id)).toEqual(["run-match"]);
  });

  it("filters cwd with home expansion", async () => {
    const homeDir = await fs.mkdtemp(
      path.join(os.homedir(), ".aihub-subagents-home-")
    );
    try {
      const cwd = path.join(homeDir, "home-run");
      await fs.mkdir(cwd, { recursive: true });
      await writeRun("run-home", [], undefined, { cwd });
      await writeRun("run-other", [], undefined, { cwd: tempDir });

      const runs = await listSubagentRuns(runtimeOptions(), {
        cwd: `~/${path.relative(os.homedir(), cwd)}`,
      });

      expect(runs.map((run) => run.id)).toEqual(["run-home"]);
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it("normalizes Claude JSONL envelopes into displayable events", async () => {
    await writeRun("run-1", [
      JSON.stringify({
        type: "system",
        subtype: "hook_started",
        hook_name: "SessionStart:startup",
      }),
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: {} }],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "internal output" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Readable assistant text." }],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Final result.",
      }),
    ]);

    const logs = await getSubagentLogs(runtimeOptions(), "run-1", 0);

    expect(logs.events).toEqual([
      {
        type: "tool_call",
        text: "{}",
        tool: { name: "Read", id: "" },
      },
      {
        type: "tool_output",
        text: "internal output",
        tool: { id: "" },
      },
      { type: "assistant", text: "Readable assistant text." },
      { type: "assistant", text: "Final result." },
    ]);
  });
});
