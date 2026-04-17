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
import { z } from "zod";
import {
  clearConfigCacheForTests,
  setLoadedConfig,
} from "../../config/index.js";
import { getContainerAdapter } from "./adapter.js";
import { validateContainerToken } from "./tokens.js";
import type { SdkRunParams } from "../types.js";

const mockGetConnectorToolGroupsForAgent = vi.hoisted(() =>
  vi.fn<(agent: unknown, config: unknown) => unknown[]>(() => [])
);
const mockGetConnectorPromptsForAgent = vi.hoisted(() =>
  vi.fn<(agent: unknown) => unknown[]>(() => [])
);

vi.mock("../../connectors/index.js", () => ({
  getConnectorToolGroupsForAgent: mockGetConnectorToolGroupsForAgent,
  getConnectorPromptsForAgent: mockGetConnectorPromptsForAgent,
}));

vi.mock("../../agents/workspace.js", () => ({
  ensureBootstrapFiles: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

const OUTPUT_START = "---AIHUB_OUTPUT_START---";
const OUTPUT_END = "---AIHUB_OUTPUT_END---";
const EVENT_PREFIX = "---AIHUB_EVENT---";

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

  emitStreamEvent(event: unknown, split = false): void {
    const line = `${EVENT_PREFIX}${JSON.stringify(event)}\n`;
    if (!split) {
      this.stdout.write(line);
      return;
    }
    const middle = Math.floor(line.length / 2);
    this.stdout.write(line.slice(0, middle));
    this.stdout.write(line.slice(middle));
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

/** Flush microtask queue so the async run() reaches spawn. */
const tick = () => new Promise((r) => setTimeout(r, 0));

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
    model: {
      provider: "anthropic",
      model: "claude-sonnet",
      auth_token: "secret-token",
    },
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
  fs.writeFileSync(path.join(root, "onecli-ca.pem"), "cert");
  setLoadedConfig({
    agents: [agent],
    components: {},
    sandbox: {
      sharedDir: path.join(root, "shared"),
    },
    onecli: {
      enabled: true,
      mode: "proxy",
      gatewayUrl: "http://onecli:4141",
      ca: { source: "file", path: path.join(root, "onecli-ca.pem") },
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
  mockGetConnectorToolGroupsForAgent.mockReturnValue([]);
  mockGetConnectorPromptsForAgent.mockReturnValue([]);
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
    mockGetConnectorToolGroupsForAgent.mockReturnValue([
      {
        connectorId: "github",
        tools: [
          {
            name: "github_search",
            description: "Search GitHub",
            parameters: z.object({ query: z.string() }),
            execute: async () => ({ ok: true }),
          },
        ],
      },
    ]);
    mockGetConnectorPromptsForAgent.mockReturnValue([
      { id: "github", prompt: "Use GitHub tools first." },
    ]);

    const { processes, spy } = mockSpawn();
    mockExecFile();
    const params = createParams(agent);

    const run = getContainerAdapter().run(params);
    await tick();
    const dockerProcess = processes[0];
    const input = JSON.parse(dockerProcess.stdinChunks.join(""));
    expect(validateContainerToken(input.agentToken, "cloud")).toBe(true);

    dockerProcess.emitOutput({ text: "hello back" });
    dockerProcess.finish(0);

    await expect(run).resolves.toEqual({
      text: "hello back",
      aborted: undefined,
    });
    expect(validateContainerToken(input.agentToken, "cloud")).toBe(false);

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
      onecli: {
        enabled: true,
        url: "http://onecli:4141",
        caPath: "/usr/local/share/ca-certificates/onecli-ca.pem",
      },
      connectorConfigs: [
        {
          id: "github",
          systemPrompt: "Use GitHub tools first.",
          tools: [
            {
              name: "github_search",
              description: "Search GitHub",
              parameters: expect.objectContaining({
                $ref: "#/definitions/github_searchParameters",
                definitions: expect.objectContaining({
                  "github_searchParameters": expect.objectContaining({
                    type: "object",
                    properties: expect.objectContaining({
                      query: expect.objectContaining({ type: "string" }),
                    }),
                  }),
                }),
              }),
            },
          ],
        },
      ],
      sdkConfig: {
        sdk: "pi",
        model: { provider: "anthropic", model: "claude-sonnet" },
      },
    });
    expect(input.sdkConfig.model.auth_token).toBeUndefined();
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

  it("streams history events in real time from stdout", async () => {
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes } = mockSpawn();
    mockExecFile();
    const params = createParams(agent);

    const run = getContainerAdapter().run(params);
    await tick();
    const dockerProcess = processes[0];

    dockerProcess.emitStreamEvent(
      { type: "assistant_thinking", text: "plan", timestamp: 1 },
      true
    );
    dockerProcess.emitStreamEvent({
      type: "assistant_text",
      text: "hello",
      timestamp: 2,
    });

    expect(params.onHistoryEvent).toHaveBeenCalledWith({
      type: "assistant_thinking",
      text: "plan",
      timestamp: 1,
    });
    expect(params.onEvent).toHaveBeenCalledWith({
      type: "thinking",
      data: "plan",
    });
    expect(params.onHistoryEvent).toHaveBeenCalledWith({
      type: "assistant_text",
      text: "hello",
      timestamp: 2,
    });
    expect(params.onEvent).toHaveBeenCalledWith({
      type: "text",
      data: "hello",
    });

    dockerProcess.emitOutput({
      text: "hello back",
      history: [
        { type: "assistant_thinking", text: "plan", timestamp: 1 },
        { type: "assistant_text", text: "hello", timestamp: 2 },
      ],
    });
    dockerProcess.finish(0);

    await expect(run).resolves.toEqual({
      text: "hello back",
      aborted: undefined,
    });
    // 1 synthetic user event + 2 streaming events
    expect(params.onHistoryEvent).toHaveBeenCalledTimes(3);
    expect(params.onHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "user", text: "hello" })
    );
    expect(params.onEvent).not.toHaveBeenCalledWith({
      type: "text",
      data: "hello back",
    });
  });

  it("copies file_output events to outbound media", async () => {
    const root = tempDir();
    const aihubHome = path.join(root, "aihub");
    process.env.AIHUB_HOME = aihubHome;
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes } = mockSpawn();
    mockExecFile();
    const params = createParams(agent);

    const run = getContainerAdapter().run(params);
    await tick();
    const dockerProcess = processes[0];
    const dataPath = path.join(
      aihubHome,
      "agents",
      "cloud",
      "data",
      "report.csv"
    );
    fs.writeFileSync(dataPath, "a,b\n1,2\n");

    dockerProcess.emitStreamEvent({
      type: "file_output",
      path: "/workspace/data/report.csv",
      filename: "report.csv",
      mimeType: "text/csv",
      size: 99,
    });
    dockerProcess.emitOutput({ text: "done" });
    dockerProcess.finish(0);

    await expect(run).resolves.toEqual({ text: "done", aborted: undefined });
    expect(params.onEvent).toHaveBeenCalledWith({
      type: "file_output",
      fileId: expect.any(String),
      filename: "report.csv",
      mimeType: "text/csv",
      size: 8,
    });
    expect(params.onHistoryEvent).toHaveBeenCalledWith({
      type: "assistant_file",
      fileId: expect.any(String),
      filename: "report.csv",
      mimeType: "text/csv",
      size: 8,
      direction: "outbound",
      timestamp: expect.any(Number),
    });

    const event = vi
      .mocked(params.onEvent)
      .mock.calls.find(([value]) => value.type === "file_output")?.[0];
    expect(event).toBeDefined();
    if (!event || event.type !== "file_output") return;

    const outboundPath = path.join(
      aihubHome,
      "media",
      "outbound",
      `${event.fileId}.csv`
    );
    expect(fs.readFileSync(outboundPath, "utf8")).toBe("a,b\n1,2\n");

    const metadata = JSON.parse(
      fs.readFileSync(path.join(aihubHome, "media", "metadata.json"), "utf8")
    );
    expect(metadata[event.fileId]).toMatchObject({
      direction: "outbound",
      filename: "report.csv",
      storedFilename: `${event.fileId}.csv`,
      mimeType: "text/csv",
      size: 8,
      agentId: "cloud",
      sessionId: "session-1",
    });
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
    await vi.advanceTimersByTimeAsync(0);
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
    await tick();
    processes[0].stderr.write("boom");
    processes[0].finish(1);

    await expect(run).rejects.toThrow("boom");
  });

  it("embeds per-agent onecli token into proxy URL", async () => {
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root);
    // Override config with top-level onecli that has per-agent token
    setLoadedConfig({
      agents: [{ ...agent, onecliToken: "tok-sally-123" }],
      components: {},
      onecli: {
        enabled: true,
        mode: "proxy",
        gatewayUrl: "http://onecli:10255",
      },
      sandbox: {},
    } as GatewayConfig);

    const { processes } = mockSpawn();
    mockExecFile();
    const params = createParams(agent);

    const run = getContainerAdapter().run(params);
    await tick();
    const dockerProcess = processes[0];
    const input = JSON.parse(dockerProcess.stdinChunks.join(""));

    dockerProcess.emitOutput({ text: "ok" });
    dockerProcess.finish(0);

    await expect(run).resolves.toEqual({ text: "ok", aborted: undefined });
    expect(input.onecli.url).toBe("http://onecli:tok-sally-123@onecli:10255");
  });

  it("rejects successful exits with missing sentinels", async () => {
    const root = tempDir();
    process.env.AIHUB_HOME = path.join(root, "aihub");
    const agent = createAgent(root);
    setConfig(agent, root);
    const { processes } = mockSpawn();
    mockExecFile();

    const run = getContainerAdapter().run(createParams(agent));
    await tick();
    processes[0].stdout.write("plain stdout");
    processes[0].finish(0);

    await expect(run).rejects.toThrow(
      "Container exited without protocol output (code 0)"
    );
  });
});
