import { describe, expect, it } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import { ContainerInputBuilder } from "./input-builder.js";
import type { SdkRunParams } from "../types.js";

describe("container input builder", () => {
  it("builds container input without leaking model auth tokens", async () => {
    const builder = new ContainerInputBuilder({
      buildSystemPrompts: async () => ["extra prompt"],
      buildTools: async () => [
        {
          extensionId: "board",
          name: "scratchpad.read",
          description: "Read",
          parameters: { type: "object" },
        },
      ],
    });
    const params = {
      agentId: "cloud",
      sessionId: "session-1",
      userId: "user-1",
      message: "hello",
      thinkLevel: "medium",
      attachments: [
        {
          path: "/host/inbound/a.txt",
          filename: "a.txt",
          mimeType: "text/plain",
          size: 1,
        },
      ],
      agent: {
        id: "cloud",
        model: {
          provider: "anthropic",
          model: "claude-sonnet",
          auth_token: "secret",
        },
      },
    } as SdkRunParams;
    const config = {
      agents: [params.agent],
      extensions: {},
      gateway: { port: 4100 },
    } as GatewayConfig;

    const input = await builder.build(params, config, "token-1");

    expect(input).toMatchObject({
      agentId: "cloud",
      sessionId: "session-1",
      gatewayUrl: "http://host.docker.internal:4100",
      agentToken: "token-1",
      extensionSystemPrompts: ["extra prompt"],
      extensionTools: [{ extensionId: "board", name: "scratchpad.read" }],
      attachments: [{ path: "/workspace/uploads/1-a.txt" }],
      sdkConfig: {
        sdk: "pi",
        model: { provider: "anthropic", model: "claude-sonnet" },
      },
    });
    expect(input.sdkConfig.model.auth_token).toBeUndefined();
  });
});
