import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContainerInput } from "@aihub/shared";
import {
  abortClaudeAgent,
  runClaudeAgent,
  sendClaudeFollowUpMessage,
} from "../claude-runner.js";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile,
}));

afterEach(() => {
  childProcessMock.execFile.mockReset();
});

describe("claude runner", () => {
  it("spawns claude CLI and parses json output", async () => {
    childProcessMock.execFile.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify({ result: "hello from claude", session_id: "claude-s2" }), "");
        return { kill: vi.fn() };
      }
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-claude-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    const sessionStatePath = path.join(sessionDir, "agent-1", "session-1.json");
    await fs.mkdir(path.dirname(sessionStatePath), { recursive: true });
    await fs.writeFile(
      sessionStatePath,
      JSON.stringify({ sessionId: "claude-s1" }),
      "utf8"
    );

    const output = await runClaudeAgent(
      createInput({ workspaceDir, sessionDir })
    );

    expect(output.text).toBe("hello from claude");
    expect(
      output.history?.map((event) => (event as { type: string }).type)
    ).toEqual(["user", "assistant_text", "turn_end"]);

    expect(childProcessMock.execFile).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--print",
        "--output-format",
        "json",
        "-r",
        "claude-s1",
        "--model",
        "claude-sonnet-4-6",
      ]),
      expect.objectContaining({ cwd: workspaceDir }),
      expect.any(Function as unknown as (...args: unknown[]) => void)
    );

    const updatedState = JSON.parse(await fs.readFile(sessionStatePath, "utf8"));
    expect(updatedState).toEqual({ sessionId: "claude-s2" });

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("queues follow-up IPC text into the prompt", async () => {
    childProcessMock.execFile.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify({ result: "ok" }), "");
        return { kill: vi.fn() };
      }
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-claude-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    await sendClaudeFollowUpMessage({ message: "keep going" });
    await runClaudeAgent(createInput({ workspaceDir, sessionDir }));

    const args = childProcessMock.execFile.mock.calls[0]?.[1] as string[];
    const promptIndex = args.indexOf("-p");
    expect(promptIndex).toBeGreaterThan(-1);
    expect(args[promptIndex + 1]).toContain("Follow-up: keep going");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("aborts active claude subprocess with SIGTERM", async () => {
    let callbackRef:
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | undefined;

    const kill = vi.fn(() => {
      const abortError = Object.assign(new Error("terminated"), {
        signal: "SIGTERM",
      });
      callbackRef?.(abortError, "", "");
      return true;
    });

    childProcessMock.execFile.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callbackRef = callback as (
          error: Error | null,
          stdout: string,
          stderr: string
        ) => void;
        return { kill };
      }
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-claude-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    const runPromise = runClaudeAgent(createInput({ workspaceDir, sessionDir }));

    await vi.waitFor(() => {
      expect(childProcessMock.execFile).toHaveBeenCalledTimes(1);
    });

    abortClaudeAgent();
    const output = await runPromise;

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(output.aborted).toBe(true);

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

function createInput(paths: {
  workspaceDir: string;
  sessionDir: string;
}): ContainerInput {
  return {
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspaceDir: paths.workspaceDir,
    sessionDir: paths.sessionDir,
    ipcDir: "/ipc",
    gatewayUrl: "http://gateway:3000",
    agentToken: "token-1",
    sdkConfig: {
      sdk: "claude",
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      },
    },
  };
}
