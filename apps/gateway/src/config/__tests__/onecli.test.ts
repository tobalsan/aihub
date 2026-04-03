import { describe, expect, it } from "vitest";
import {
  GatewayConfigSchema,
  OnecliConfigSchema,
  type GatewayConfig,
} from "@aihub/shared";
import { buildOnecliEnv } from "../onecli.js";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return GatewayConfigSchema.parse({
    agents: [
      {
        id: "sally",
        name: "Sally",
        workspace: "~/agents/sally",
        model: {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
        },
      },
    ],
    ...overrides,
  });
}

describe("OneCLI env builder", () => {
  it("returns null when onecli is not configured", () => {
    expect(buildOnecliEnv(makeConfig(), "sally")).toBeNull();
  });

  it("returns null when onecli is disabled", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: false,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
          },
        }),
        "sally"
      )
    ).toBeNull();
  });

  it("returns null when the agent is disabled for onecli", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
            agents: {
              sally: {
                enabled: false,
                gatewayToken: "token",
              },
            },
          },
        }),
        "sally"
      )
    ).toBeNull();
  });

  it("returns proxy env vars when enabled", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
          },
        }),
        "sally"
      )
    ).toEqual({
      HTTP_PROXY: "http://localhost:10255",
      HTTPS_PROXY: "http://localhost:10255",
    });
  });

  it("embeds the gateway token in the proxy URL", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255/",
            mode: "proxy",
            agents: {
              sally: {
                enabled: true,
                gatewayToken: "abc123",
              },
            },
          },
        }),
        "sally"
      )
    ).toEqual({
      HTTP_PROXY: "http://onecli:abc123@localhost:10255",
      HTTPS_PROXY: "http://onecli:abc123@localhost:10255",
    });
  });

  it("sets CA env vars when using a CA file", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
            ca: {
              source: "file",
              path: "/tmp/onecli-ca.pem",
            },
          },
        }),
        "sally"
      )
    ).toEqual({
      HTTP_PROXY: "http://localhost:10255",
      HTTPS_PROXY: "http://localhost:10255",
      NODE_EXTRA_CA_CERTS: "/tmp/onecli-ca.pem",
      SSL_CERT_FILE: "/tmp/onecli-ca.pem",
      REQUESTS_CA_BUNDLE: "/tmp/onecli-ca.pem",
    });
  });

  it("does not set CA env vars when using system CA trust", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
            ca: {
              source: "system",
            },
          },
        }),
        "sally"
      )
    ).toEqual({
      HTTP_PROXY: "http://localhost:10255",
      HTTPS_PROXY: "http://localhost:10255",
    });
  });

  it("returns proxy env for agents without a per-agent config", () => {
    expect(
      buildOnecliEnv(
        makeConfig({
          onecli: {
            enabled: true,
            gatewayUrl: "http://localhost:10255",
            mode: "proxy",
            agents: {
              other: {
                enabled: true,
                gatewayToken: "other-token",
              },
            },
          },
        }),
        "sally"
      )
    ).toEqual({
      HTTP_PROXY: "http://localhost:10255",
      HTTPS_PROXY: "http://localhost:10255",
    });
  });
});

describe("OneCLI config schema", () => {
  it("parses valid config", () => {
    const result = OnecliConfigSchema.parse({
      enabled: true,
      gatewayUrl: "http://localhost:10255",
      dashboardUrl: "http://localhost:10254",
      ca: {
        source: "file",
        path: "/tmp/onecli-ca.pem",
      },
      agents: {
        sally: {
          gatewayToken: "token",
        },
      },
    });

    expect(result).toMatchObject({
      enabled: true,
      mode: "proxy",
      gatewayUrl: "http://localhost:10255",
      dashboardUrl: "http://localhost:10254",
    });
  });

  it("rejects invalid gatewayUrl", () => {
    const result = OnecliConfigSchema.safeParse({
      gatewayUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("defaults enabled to false", () => {
    const result = OnecliConfigSchema.parse({
      gatewayUrl: "http://localhost:10255",
    });

    expect(result.enabled).toBe(false);
  });

  it("defaults mode to proxy", () => {
    const result = OnecliConfigSchema.parse({
      gatewayUrl: "http://localhost:10255",
    });

    expect(result.mode).toBe("proxy");
  });
});
