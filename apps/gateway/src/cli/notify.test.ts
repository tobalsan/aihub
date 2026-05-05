import { describe, expect, it, vi } from "vitest";
import { GatewayConfigSchema, notify } from "@aihub/shared";
import { Command } from "commander";
import { registerNotifyCommand, runNotifyCommand } from "./notify.js";

describe("notify CLI", () => {
  it("registers a top-level notify command", () => {
    const program = new Command();
    registerNotifyCommand(program);

    const notifyCommand = program.commands.find(
      (command) => command.name() === "notify"
    );

    expect(notifyCommand).toBeDefined();
    expect(notifyCommand?.helpInformation()).toContain("--channel <channel>");
    expect(notifyCommand?.helpInformation()).toContain("--message <text>");
  });

  it("passes invalid surfaces through runtime validation before adapters run", async () => {
    const discord = vi.fn().mockResolvedValue(undefined);
    const slack = vi.fn().mockResolvedValue(undefined);
    const config = GatewayConfigSchema.parse({
      agents: [],
      extensions: {
        discord: { token: "discord-token" },
        slack: { token: "slack-token", appToken: "slack-app-token" },
      },
      notifications: {
        channels: {
          default: { discord: "discord-channel", slack: "slack-channel" },
        },
      },
    });

    await expect(
      runNotifyCommand(
        {
          channel: "default",
          message: "hi",
          surface: "bogus",
        },
        {
          loadConfig: () => config,
          resolveConfig: async (value) => value,
          notifyImpl: async (options) => {
            return notify({
              ...options,
              adapters: { discord, slack },
            });
          },
        }
      )
    ).rejects.toThrow(/Invalid notify surface "bogus"/);
    expect(discord).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
  });
});
