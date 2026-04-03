import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayConfigSchema,
  type AgentConfig,
  type GatewayConfig,
} from "@aihub/shared";
import { claudeAdapter } from "../adapter.js";
import {
  clearConfigCacheForTests,
  setLoadedConfig,
} from "../../../config/index.js";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(() => ({ close: vi.fn() })),
  tool: vi.fn(),
  query: queryMock,
}));

vi.mock("../../../agents/workspace.js", () => ({
  ensureBootstrapFiles: vi.fn(async () => undefined),
}));

vi.mock("../../../sessions/claude.js", () => ({
  getClaudeSessionId: vi.fn(() => null),
  setClaudeSessionId: vi.fn(async () => undefined),
}));

vi.mock("../../../discord/utils/context.js", () => ({
  renderAgentContext: vi.fn(() => ""),
}));

vi.mock("../../../subagents/claude_tools.js", () => ({
  createSubagentMcpServer: vi.fn(() => ({ close: vi.fn() })),
  SUBAGENT_MCP_SERVER: "aihub-subagents",
  SUBAGENT_TOOL_NAMES: {
    run: "run",
  },
}));

vi.mock("../../../connectors/index.js", () => ({
  getConnectorPromptsForAgent: vi.fn(() => []),
  getConnectorToolsForAgent: vi.fn(() => []),
}));

function makeAgent(overrides: Partial<AgentConfig["model"]> = {}): AgentConfig {
  return {
    id: "claude-agent",
    name: "Claude Agent",
    workspace: "~/agent",
    sdk: "claude",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4",
      ...overrides,
    },
    queueMode: "queue",
  };
}

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return GatewayConfigSchema.parse({
    agents: [makeAgent()],
    ...overrides,
  });
}

async function* successConversation() {
  yield {
    type: "result",
    subtype: "success",
    result: "ok",
  };
}

describe("claude adapter onecli env wiring", () => {
  const envKeys = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
  ] as const;
  const envSnapshot = new Map<string, string | undefined>();

  beforeEach(() => {
    queryMock.mockReset();
    clearConfigCacheForTests();
    for (const key of envKeys) {
      envSnapshot.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    clearConfigCacheForTests();
    for (const key of envKeys) {
      const value = envSnapshot.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("sets onecli proxy env vars during the run and restores them after", async () => {
    setLoadedConfig(
      makeConfig({
        onecli: {
          enabled: true,
          gatewayUrl: "http://localhost:10255",
          mode: "proxy",
          ca: {
            source: "file",
            path: "/tmp/onecli-ca.pem",
          },
          agents: {
            "claude-agent": {
              enabled: true,
              gatewayToken: "secret-token",
            },
          },
        },
      })
    );

    process.env.HTTP_PROXY = "http://prior-proxy";
    process.env.HTTPS_PROXY = "http://prior-proxy";
    process.env.NODE_EXTRA_CA_CERTS = "/tmp/prior-ca.pem";

    const snapshots: Array<Record<string, string | undefined>> = [];
    queryMock.mockImplementation(() => {
      snapshots.push({
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
        REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      });
      return successConversation();
    });

    const result = await claudeAdapter.run({
      agentId: "claude-agent",
      agent: makeAgent(),
      sessionId: "session-1",
      message: "ping",
      workspaceDir: "/tmp",
      onEvent: () => undefined,
      onHistoryEvent: () => undefined,
      abortSignal: new AbortController().signal,
    });

    expect(result.text).toBe("ok");
    expect(snapshots).toEqual([
      {
        HTTP_PROXY: "http://onecli:secret-token@localhost:10255",
        HTTPS_PROXY: "http://onecli:secret-token@localhost:10255",
        NODE_EXTRA_CA_CERTS: "/tmp/onecli-ca.pem",
        SSL_CERT_FILE: "/tmp/onecli-ca.pem",
        REQUESTS_CA_BUNDLE: "/tmp/onecli-ca.pem",
      },
    ]);
    expect(process.env.HTTP_PROXY).toBe("http://prior-proxy");
    expect(process.env.HTTPS_PROXY).toBe("http://prior-proxy");
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe("/tmp/prior-ca.pem");
    expect(process.env.SSL_CERT_FILE).toBeUndefined();
    expect(process.env.REQUESTS_CA_BUNDLE).toBeUndefined();
  });

  it("does not set onecli proxy env vars when onecli is not enabled", async () => {
    setLoadedConfig(makeConfig());

    const snapshots: Array<Record<string, string | undefined>> = [];
    queryMock.mockImplementation(() => {
      snapshots.push({
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
      });
      return successConversation();
    });

    await claudeAdapter.run({
      agentId: "claude-agent",
      agent: makeAgent(),
      sessionId: "session-1",
      message: "ping",
      workspaceDir: "/tmp",
      onEvent: () => undefined,
      onHistoryEvent: () => undefined,
      abortSignal: new AbortController().signal,
    });

    expect(snapshots).toEqual([
      {
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        NODE_EXTRA_CA_CERTS: undefined,
      },
    ]);
  });

  it("applies onecli env vars alongside model overrides", async () => {
    setLoadedConfig(
      makeConfig({
        onecli: {
          enabled: true,
          gatewayUrl: "http://localhost:10255",
          mode: "proxy",
        },
      })
    );

    const snapshots: Array<Record<string, string | undefined>> = [];
    queryMock.mockImplementation(() => {
      snapshots.push({
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
      });
      return successConversation();
    });

    await claudeAdapter.run({
      agentId: "claude-agent",
      agent: makeAgent({
        base_url: "https://anthropic-proxy.internal",
        auth_token: "model-token",
      }),
      sessionId: "session-1",
      message: "ping",
      workspaceDir: "/tmp",
      onEvent: () => undefined,
      onHistoryEvent: () => undefined,
      abortSignal: new AbortController().signal,
    });

    expect(snapshots).toEqual([
      {
        ANTHROPIC_BASE_URL: "https://anthropic-proxy.internal",
        ANTHROPIC_AUTH_TOKEN: "model-token",
        HTTP_PROXY: "http://localhost:10255",
        HTTPS_PROXY: "http://localhost:10255",
      },
    ]);
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
  });
});
