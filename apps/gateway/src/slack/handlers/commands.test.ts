import type { AgentConfig, SlackComponentConfig } from "@aihub/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAbortCommand,
  handleHelpCommand,
  handleNewCommand,
  handlePingCommand,
  type SlackCommandTarget,
} from "./commands.js";
import { runAgent } from "../../agents/index.js";

vi.mock("../../agents/index.js", () => ({
  runAgent: vi.fn(),
}));

const mockRunAgent = vi.mocked(runAgent);

const agent: AgentConfig = {
  id: "main",
  name: "Main",
  workspace: "~/main",
  model: { provider: "anthropic", model: "claude" },
  queueMode: "queue",
};

const config: SlackComponentConfig = {
  token: "xoxb-test",
  appToken: "xapp-test",
  channels: {
    C1: { agent: "main", threadPolicy: "always" },
  },
  dm: { enabled: true, agent: "main" },
};

const target: SlackCommandTarget = {
  agent,
  config,
  channelConfig: config.channels?.C1,
  isDm: false,
};

describe("Slack command handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgent.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 1, sessionId: "session" },
    });
  });

  it("runs /new against the route session", async () => {
    const respond = vi.fn();
    await handleNewCommand(
      { channel_id: "C1", user_id: "U1", text: "" },
      target,
      respond
    );

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        message: "/new",
        sessionKey: "slack:C1",
        source: "slack",
      })
    );
    expect(respond).toHaveBeenCalledWith({
      text: "ok",
      response_type: "ephemeral",
    });
  });

  it("runs /stop against requested session", async () => {
    const respond = vi.fn();
    await handleAbortCommand(
      { channel_id: "C1", user_id: "U1", text: "custom" },
      target,
      respond
    );
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ message: "/stop", sessionKey: "custom" })
    );
  });

  it("uses main session for DMs", async () => {
    const respond = vi.fn();
    await handleNewCommand(
      { channel_id: "D1", user_id: "U1", text: "" },
      { ...target, isDm: true, channelConfig: undefined },
      respond
    );
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "main" })
    );
  });

  it("responds to help and ping ephemerally", async () => {
    const helpRespond = vi.fn();
    const pingRespond = vi.fn();
    await handleHelpCommand({ channel_id: "C1", user_id: "U1" }, target, helpRespond);
    await handlePingCommand({ channel_id: "C1", user_id: "U1" }, target, pingRespond);

    expect(helpRespond.mock.calls[0][0].text).toContain("/new");
    expect(helpRespond.mock.calls[0][0].text).toContain("/stop");
    expect(helpRespond.mock.calls[0][0].text).not.toContain("/abort");
    expect(helpRespond.mock.calls[0][0].response_type).toBe("ephemeral");
    expect(pingRespond.mock.calls[0][0].text).toContain("Main");
    expect(pingRespond.mock.calls[0][0].response_type).toBe("ephemeral");
  });
});
