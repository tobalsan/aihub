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
const mockGetLoadedComponents = vi.fn(() => []);
const mockRenderAgentContext = vi.fn(() => "");

vi.mock("../../agents/workspace.js", () => ({
  ensureBootstrapFiles: mockEnsureBootstrapFiles,
  loadBootstrapFiles: mockLoadBootstrapFiles,
  buildBootstrapContextFiles: mockBuildBootstrapContextFiles,
}));

vi.mock("../../sessions/store.js", () => ({
  getSessionCreatedAt: vi.fn(() => undefined),
  formatSessionTimestamp: vi.fn(() => "20260404_000000"),
}));

vi.mock("../../discord/utils/context.js", () => ({
  renderAgentContext: mockRenderAgentContext,
}));

vi.mock("../../subagents/pi_tools.js", () => ({
  createPiSubagentTools: vi.fn(() => []),
}));

vi.mock("../../connectors/index.js", () => ({
  getConnectorPromptsForAgent: mockGetConnectorPromptsForAgent,
  getConnectorToolsForAgent: mockGetConnectorToolsForAgent,
}));

vi.mock("../../components/registry.js", () => ({
  getLoadedComponents: mockGetLoadedComponents,
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

function makeAgent(): AgentConfig {
  return {
    id: "pi-agent",
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
      agents: [agent],
      onecli: {
        enabled: true,
        mode: "proxy",
        gatewayUrl: "http://localhost:10255",
        ca: {
          source: "file",
          path: "/tmp/onecli-ca.pem",
        },
        agents: {
          [agent.id]: {
            gatewayToken: "token",
          },
        },
      },
    } as GatewayConfig;
    const session = {
      messages: [{ role: "assistant", content: "done" }],
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
});
