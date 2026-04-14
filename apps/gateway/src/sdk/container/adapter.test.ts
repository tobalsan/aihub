import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  AgentConfigSchema,
  type AgentConfig,
  type GatewayConfig,
} from "@aihub/shared";
import {
  clearConfigCacheForTests,
  setLoadedConfig,
} from "../../config/index.js";
import { getContainerAdapter } from "./adapter.js";
import type { SdkRunParams } from "../types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

const OUTPUT_START = "---AIHUB_OUTPUT_START---";
const OUTPUT_END = "---AIHUB_OUTPUT_END---";

class FakeDockerProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdinChunks: string[] = [];
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinChunks.push(chunk.toString());
      callback();
    },
  });

  emitOutput(output: unknown): void {
    this.stdout.write(
      `${OUTPUT_START}\n${JSON.stringify(output)}\n${OUTPUT_END}\n`
    );
  }

  finish(code: number): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aihub-container-adapter-")
  );
  tempDirs.push(dir);
  return dir;
}

function createAgent(
  root: string,
  sandbox: Partial<NonNullable<AgentConfig["sandbox"]>> = {}
): AgentConfig {
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return AgentConfigSchema.parse({
    id: "cloud",
    name: "Cloud",
    workspace,
    model: { provider: "anthropic", model: "claude-sonnet" },
    sandbox: {
      enabled: true,
      image: "aihub-agent:latest",
      memory: "2g",
      cpus: 1,
      timeout: 300,
      workspaceWritable: false,
      ...sandbox,
    },
  });
}

function setConfig(agent: AgentConfig, root: string): void {
  setLoadedConfig({
    agents: [agent],
    components: {},
    sandbox: {
      sharedDir: path.join(root, "shared"),
      onecli: { enabled: true, url: "http://onecli:4141" },
    },
    server: { baseUrl: "http://gateway:4000" },
  } as GatewayConfig);
}

function createParams(agent: AgentConfig): SdkRunParams {
  const abortController = new AbortController();
  return {
    agentId: agent.id,
    agent,
    userId: "user-1",
    sessionId: "session-1",
    message: "hello",
    attachments: [{ path: "/tmp/a.txt", mimeType: "text/plain" }],
    workspaceDir: agent.workspace,
    thinkLevel: "medium",
    onEvent: vi.fn(),
    onHistoryEvent: vi.fn(),
    onSessionHandle: vi.fn(),
    abortSignal: abortController.signal,
  };
}

function mockSpawn(): {
  processes: FakeDockerProcess[];
  spy: MockInstance;
} {
  const processes: FakeDockerProcess[] = [];
  const spy = vi
    .mocked(childProcess.spawn)
    .mockImplementation((_command, _args, _options) => {
      const process = new FakeDockerProcess();
      processes.push(process);
      return process as never;
    });
  return { processes, spy };
}

function mockExecFile(complete = true): MockInstance {
  return vi
    .mocked(childProcess.execFile)
    .mockImplementation((_file, _args, _options, callback) => {
      if (complete && typeof callback === "function") {
        callback(null, "", "");
      }
      return new EventEmitter() as never;
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AIHUB_HOME;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  clearConfigCacheForTests();
  delete process.env.AIHUB_HOME;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("container adapter", () => {
  it("spawns docker and writes ContainerInput to stdin", async () => {
    const root = tempDir();
    const aihubHome = path.join(root, "aihub");
    process.env.AIHUB_HOME = aihubHome;
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes, spy } = mockSpawn();
    mockExecFile();
    const params = createParams(agent);

    const run = getContainerAdapter().run(params);
    const dockerProcess = processes[0];
    dockerProcess.emitOutput({ text: "hello back" });
    dockerProcess.finish(0);

    await expect(run).resolves.toEqual({
      text: "hello back",
      aborted: undefined,
    });
    const input = JSON.parse(dockerProcess.stdinChunks.join(""));

    expect(spy).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["run", "-i", "--rm"]),
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    expect(input).toMatchObject({
      agentId: "cloud",
      sessionId: "session-1",
      userId: "user-1",
      message: "hello",
      workspaceDir: "/workspace",
      sessionDir: "/sessions",
      ipcDir: "/workspace/ipc",
      gatewayUrl: "http://gateway:4000",
      onecli: { enabled: true, url: "http://onecli:4141" },
      sdkConfig: {
        sdk: "pi",
        model: { provider: "anthropic", model: "claude-sonnet" },
      },
    });
    expect(input.agentToken).toEqual(expect.any(String));
    expect(params.onSessionHandle).toHaveBeenCalledWith({
      containerName: expect.stringMatching(/^aihub-agent-cloud-/),
      ipcDir: path.join(aihubHome, "ipc", "cloud"),
    });
    expect(params.onEvent).toHaveBeenCalledWith({
      type: "text",
      data: "hello back",
    });
    expect(params.onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "done" })
    );
  });

  it("writes queued messages to the IPC input dir", async () => {
    const root = tempDir();
    const ipcDir = path.join(root, "ipc", "cloud");
    vi.spyOn(Date, "now").mockReturnValue(123);

    await getContainerAdapter().queueMessage?.(
      { containerName: "container", ipcDir },
      "follow up"
    );

    expect(
      JSON.parse(
        fs.readFileSync(path.join(ipcDir, "input", "123.json"), "utf8")
      )
    ).toEqual({ message: "follow up", timestamp: 123 });
  });

  it("writes close sentinel and stops on abort", () => {
    const root = tempDir();
    const ipcDir = path.join(root, "ipc", "cloud");
    const execSpy = mockExecFile();

    getContainerAdapter().abort?.({ containerName: "container", ipcDir });

    expect(fs.existsSync(path.join(ipcDir, "input", "_close"))).toBe(true);
    expect(execSpy).toHaveBeenCalledWith(
      "docker",
      ["stop", "container"],
      { timeout: 10_000 },
      expect.any(Function)
    );
  });

  it("stops then kills on timeout", async () => {
    vi.useFakeTimers();
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root, { timeout: 1 });
    setConfig(agent, root);
    const { processes } = mockSpawn();
    const execSpy = mockExecFile(false);

    const run = getContainerAdapter().run(createParams(agent));
    vi.advanceTimersByTime(1_000);
    expect(execSpy).toHaveBeenCalledWith(
      "docker",
      ["stop", expect.stringMatching(/^aihub-agent-cloud-/)],
      { timeout: 10_000 },
      expect.any(Function)
    );

    vi.advanceTimersByTime(10_000);
    expect(execSpy).toHaveBeenCalledWith(
      "docker",
      ["kill", expect.stringMatching(/^aihub-agent-cloud-/)],
      { timeout: 5_000 },
      expect.any(Function)
    );

    processes[0].finish(137);
    await expect(run).rejects.toThrow("Container timed out after 1s");
  });

  it("rejects non-zero exits without protocol output", async () => {
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes } = mockSpawn();
    mockExecFile();

    const run = getContainerAdapter().run(createParams(agent));
    processes[0].stderr.write("boom");
    processes[0].finish(1);

    await expect(run).rejects.toThrow("boom");
  });

  it("rejects successful exits with missing sentinels", async () => {
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes } = mockSpawn();
    mockExecFile();

    const run = getContainerAdapter().run(createParams(agent));
    processes[0].stdout.write("plain stdout");
    processes[0].finish(0);

    await expect(run).rejects.toThrow(
      "Container exited without protocol output (code 0)"
    );
  });
});
