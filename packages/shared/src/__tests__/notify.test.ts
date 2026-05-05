import { describe, expect, it, vi } from "vitest";
import { notify } from "../notify.js";

const config = {
  channels: {
    default: { discord: "discord-channel", slack: "slack-channel" },
    alerts: { slack: "alerts-channel" },
  },
};

describe("notify", () => {
  it("sends discord notifications to the resolved channel id", async () => {
    const discord = vi.fn().mockResolvedValue(undefined);

    const result = await notify({
      config,
      channel: "default",
      surface: "discord",
      message: "hi",
      discordToken: "discord-token",
      adapters: { discord },
    });

    expect(result.ok).toBe(true);
    expect(discord).toHaveBeenCalledWith({
      channelId: "discord-channel",
      text: "hi",
      token: "discord-token",
      fetchImpl: expect.any(Function),
    });
  });

  it("fans out to both configured surfaces", async () => {
    const discord = vi.fn().mockResolvedValue(undefined);
    const slack = vi.fn().mockResolvedValue(undefined);

    const result = await notify({
      config,
      channel: "default",
      surface: "both",
      message: "hi",
      discordToken: "discord-token",
      slackToken: "slack-token",
      adapters: { discord, slack },
    });

    expect(result.ok).toBe(true);
    expect(result.results.map((entry) => entry.surface)).toEqual([
      "discord",
      "slack",
    ]);
    expect(discord).toHaveBeenCalledOnce();
    expect(slack).toHaveBeenCalledOnce();
  });

  it("errors clearly when the channel is missing", async () => {
    await expect(
      notify({
        config,
        channel: "missing",
        message: "hi",
      })
    ).rejects.toThrow(/Notification channel not configured: missing/);
  });

  it("rejects invalid surfaces before adapters run", async () => {
    const discord = vi.fn().mockResolvedValue(undefined);
    const slack = vi.fn().mockResolvedValue(undefined);

    await expect(
      notify({
        config,
        channel: "default",
        surface: "bogus",
        message: "hi",
        discordToken: "discord-token",
        slackToken: "slack-token",
        adapters: { discord, slack },
      })
    ).rejects.toThrow(/Invalid notify surface "bogus"/);
    expect(discord).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
  });

  it("requires Slack responses to be parseable JSON with ok true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await notify({
      config,
      channel: "default",
      surface: "slack",
      message: "hi",
      slackToken: "slack-token",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.results[0].error).toMatch(/Slack response was not valid JSON/);
  });

  it("rejects Slack responses missing ok true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({ ts: "123.456" }, { status: 200 })
    );

    const result = await notify({
      config,
      channel: "default",
      surface: "slack",
      message: "hi",
      slackToken: "slack-token",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.results[0].error).toMatch(/Slack response missing ok: true/);
  });
});
