import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, GatewayConfig } from "@aihub/shared";
import type { SdkRunParams } from "../../types.js";
import {
  clearConfigCacheForTests,
  setLoadedConfig,
} from "../../../config/index.js";

const mockCreateAgentSession = vi.fn();
const mockCreateCodingTools = vi.fn(() => []);
const mockGetEnvApiKey = vi.fn(() => "env-api-key");
const mockEnsureBootstrapFiles = vi.fn(async () => undefined);
const mockLoadBootstrapFiles = vi.fn(async () => []);
const mockBuildBootstrapContextFiles = vi.fn(() => []);
const mockGetConnectorToolsForAgent = vi.fn(() => []);
const mockGetConnectorPromptsForAgent = vi.fn(() => []);
const mockGetLoadedExtensions = vi.fn(() => []);

vi.mock("../../agents/workspace.js", () => ({
  ensureBootstrapFiles: mockEnsureBootstrapFiles,
  loadBootstrapFiles: mockLoadBootstrapFiles,
  buildBootstrapContextFiles: mockBuildBootstrapContextFiles,
}));

vi.mock("../../sessions/store.js", () => ({
  getSessionCreatedAt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../sessions/files.js", () => ({
  resolveSessionDataFile: vi.fn(async () => "/tmp/aihub-test/sessions/session-1.jsonl"),
}));

vi.mock("@aihub/extension-projects/pi-tools", () => ({
  createPiSubagentTools: vi.fn(() => []),
}));

vi.mock("../../connectors/index.js", () => ({
  getConnectorPromptsForAgent: mockGetConnectorPromptsForAgent,
  getConnectorToolsForAgent: mockGetConnectorToolsForAgent,
}));

vi.mock("../../extensions/registry.js", () => ({
  getLoadedExtensions: mockGetLoadedExtensions,
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getEnvApiKey: mockGetEnvApiKey,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  SessionManager: {
    open: vi.fn(() => ({ close: vi.fn() })),
  },
  SettingsManager: {
    create: vi.fn(() => ({})),
  },
  AuthStorage: {
    create: vi.fn(() => ({
      get: vi.fn(() => undefined),
      setRuntimeApiKey: vi.fn(),
    })),
  },
  ModelRegistry: {
    create: vi.fn(() => ({
      find: vi.fn(() => ({ provider: "anthropic" })),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "runtime-key" })),
    })),
  },
  DefaultResourceLoader: class {
    async reload() {
      return undefined;
    }
  },
  createCodingTools: mockCreateCodingTools,
}));

function makeAgent(id = "pi-agent"): AgentConfig {
  return {
    id,
    name: "Pi Agent",
    workspace: "~/agents/pi-agent",
    sdk: "pi",
    queueMode: "queue",
    model: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
  };
}

function makeRunParams(agent: AgentConfig): SdkRunParams {
  return {
    agentId: agent.id,
    agent,
    sessionId: "session-1",
    message: "hello",
    workspaceDir: "/tmp/workspace",
    onEvent: vi.fn(),
    onHistoryEvent: vi.fn(),
    abortSignal: new AbortController().signal,
  };
}

describe("pi adapter onecli env wiring", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCacheForTests();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    clearConfigCacheForTests();
    process.env = { ...originalEnv };
  });

  it("sets proxy env before session creation and restores it after the run", async () => {
    const agent = makeAgent();
    const config = {
      agents: [{ ...agent, onecliToken: "token" }],
      onecli: {
        enabled: true,
        mode: "proxy",
        gatewayUrl: "http://localhost:10255",
        ca: {
          source: "file",
          path: "/tmp/onecli-ca.pem",
        },
      },
    } as GatewayConfig;
    const session = {
      messages: [{ role: "assistant", content: "done" }],
      agent: {
        state: {
          messages: [],
          systemPrompt: "You are Sally.\n\n[CHANNEL CONTEXT]\nchannel: slack",
        },
      },
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const capturedEnv: Record<string, string | undefined>[] = [];

    setLoadedConfig(config);
    mockCreateAgentSession.mockImplementation(async () => {
      capturedEnv.push({
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
        REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      });
      return { session };
    });

    process.env.HTTP_PROXY = "http://old-proxy";
    delete process.env.HTTPS_PROXY;
    delete process.env.NODE_EXTRA_CA_CERTS;
    process.env.SSL_CERT_FILE = "/tmp/original-ca.pem";
    delete process.env.REQUESTS_CA_BUNDLE;

    const { piAdapter } = await import("../adapter.js");
    const result = await piAdapter.run(makeRunParams(agent));

    expect(result).toEqual({ text: "done", aborted: false });
    expect(capturedEnv).toEqual([
      {
        HTTP_PROXY: "http://onecli:token@localhost:10255",
        HTTPS_PROXY: "http://onecli:token@localhost:10255",
        NODE_EXTRA_CA_CERTS: "/tmp/onecli-ca.pem",
        SSL_CERT_FILE: "/tmp/onecli-ca.pem",
        REQUESTS_CA_BUNDLE: "/tmp/onecli-ca.pem",
      },
    ]);
    expect(process.env.HTTP_PROXY).toBe("http://old-proxy");
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    expect(process.env.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(process.env.SSL_CERT_FILE).toBe("/tmp/original-ca.pem");
    expect(process.env.REQUESTS_CA_BUNDLE).toBeUndefined();
  });

  it("leaves env unchanged when onecli is not enabled", async () => {
    const agent = makeAgent();
    const config = { agents: [agent] } as GatewayConfig;
    const session = {
      messages: [{ role: "assistant", content: "done" }],
      agent: {
        state: {
          messages: [],
          systemPrompt: "You are Sally.\n\n[CHANNEL CONTEXT]\nchannel: slack",
        },
      },
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const capturedEnv: Record<string, string | undefined>[] = [];

    setLoadedConfig(config);
    mockCreateAgentSession.mockImplementation(async () => {
      capturedEnv.push({
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
      });
      return { session };
    });

    process.env.HTTP_PROXY = "http://unchanged-proxy";
    process.env.HTTPS_PROXY = "http://unchanged-secure-proxy";
    process.env.NODE_EXTRA_CA_CERTS = "/tmp/unchanged-ca.pem";

    const { piAdapter } = await import("../adapter.js");
    const result = await piAdapter.run(makeRunParams(agent));

    expect(result).toEqual({ text: "done", aborted: false });
    expect(capturedEnv).toEqual([
      {
        HTTP_PROXY: "http://unchanged-proxy",
        HTTPS_PROXY: "http://unchanged-secure-proxy",
        NODE_EXTRA_CA_CERTS: "/tmp/unchanged-ca.pem",
      },
    ]);
    expect(process.env.HTTP_PROXY).toBe("http://unchanged-proxy");
    expect(process.env.HTTPS_PROXY).toBe("http://unchanged-secure-proxy");
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe("/tmp/unchanged-ca.pem");
  });

  it("serializes concurrent runs so onecli env mutations do not overlap", async () => {
    const firstAgent = { ...makeAgent("pi-agent-1"), onecliToken: "token-1" } as AgentConfig;
    const secondAgent = { ...makeAgent("pi-agent-2"), onecliToken: "token-2" } as AgentConfig;
    const config = {
      agents: [firstAgent, secondAgent],
      onecli: {
        enabled: true,
        mode: "proxy",
        gatewayUrl: "http://localhost:10255",
      },
    } as GatewayConfig;

    let releaseFirstPrompt: (() => void) | undefined;
    const firstPromptStarted = new Promise<void>((resolve) => {
      releaseFirstPrompt = resolve;
    });
    let completeFirstPrompt: (() => void) | undefined;
    const firstPromptCompleted = new Promise<void>((resolve) => {
      completeFirstPrompt = resolve;
    });
    const createOrder: string[] = [];
    const envSnapshots: Array<{ agentId: string; httpProxy: string | undefined }> =
      [];

    setLoadedConfig(config);
    mockCreateAgentSession.mockImplementation(async ({ model }: { model: { provider: string } }) => {
      const agentId =
        process.env.HTTP_PROXY === "http://onecli:token-1@localhost:10255"
          ? firstAgent.id
          : secondAgent.id;
      createOrder.push(agentId);
      envSnapshots.push({
        agentId,
        httpProxy: process.env.HTTP_PROXY,
      });

      return {
        session: {
          messages: [{ role: "assistant", content: agentId }],
          agent: { state: { messages: [] } },
          subscribe: vi.fn(() => vi.fn()),
          prompt: vi.fn(async () => {
            if (model.provider && agentId === firstAgent.id) {
              completeFirstPrompt?.();
              await firstPromptStarted;
            }
          }),
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const { piAdapter } = await import("../adapter.js");
    const firstRun = piAdapter.run(makeRunParams(firstAgent));
    await firstPromptCompleted;

    const secondRun = piAdapter.run({
      ...makeRunParams(secondAgent),
      sessionId: "session-2",
    });

    await Promise.resolve();
    expect(createOrder).toEqual([firstAgent.id]);
    expect(process.env.HTTP_PROXY).toBe("http://onecli:token-1@localhost:10255");

    releaseFirstPrompt?.();

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

    expect(firstResult).toEqual({ text: firstAgent.id, aborted: false });
    expect(secondResult).toEqual({ text: secondAgent.id, aborted: false });
    expect(createOrder).toEqual([firstAgent.id, secondAgent.id]);
    expect(envSnapshots).toEqual([
      {
        agentId: firstAgent.id,
        httpProxy: "http://onecli:token-1@localhost:10255",
      },
      {
        agentId: secondAgent.id,
        httpProxy: "http://onecli:token-2@localhost:10255",
      },
    ]);
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it("emits the assembled system prompt into history before the run", async () => {
    const agent = makeAgent();
    const config = { agents: [agent] } as GatewayConfig;
    const session = {
      messages: [{ role: "assistant", content: "done" }],
      agent: {
        state: {
          messages: [],
          systemPrompt: "You are Sally.\n\n[CHANNEL CONTEXT]\nchannel: slack",
        },
      },
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const onHistoryEvent = vi.fn();

    setLoadedConfig(config);
    mockCreateAgentSession.mockResolvedValue({ session });

    const { piAdapter } = await import("../adapter.js");
    await piAdapter.run({
      ...makeRunParams(agent),
      onHistoryEvent,
      context: {
        kind: "slack",
        blocks: [
          {
            type: "metadata",
            channel: "slack",
            place: "direct message / Thinh",
            conversationType: "direct_message",
            sender: "Thinh",
          },
        ],
      },
    });

    expect(onHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "system_prompt",
        text: "You are Sally.\n\n[CHANNEL CONTEXT]\nchannel: slack",
      })
    );
    expect(onHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "system_context",
        rendered: expect.stringContaining("[CHANNEL CONTEXT]"),
      })
    );
  });
});
