import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfigSecrets, resolveSecretValue } from "../secrets.js";

describe("secret resolution", () => {
  afterEach(() => {
    delete process.env.TEST_SECRET_ENV;
    vi.unstubAllGlobals();
  });

  it("passes raw strings through", async () => {
    await expect(resolveSecretValue("plain-value")).resolves.toBe("plain-value");
  });

  it("resolves env refs", async () => {
    process.env.TEST_SECRET_ENV = "resolved";
    await expect(resolveSecretValue("$env:TEST_SECRET_ENV")).resolves.toBe(
      "resolved"
    );
  });

  it("errors when env ref missing", async () => {
    await expect(resolveSecretValue("$env:DOES_NOT_EXIST")).rejects.toThrow(
      'Env var "DOES_NOT_EXIST" not set'
    );
  });

  it("errors when onecli is not configured", async () => {
    await expect(resolveSecretValue("$secret:discord_bot")).rejects.toThrow(
      'Secret "discord_bot" requires secrets.provider="onecli" with gatewayUrl'
    );
  });

  it("resolves onecli secret refs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ value: "discord-token" }),
      }))
    );

    await expect(
      resolveSecretValue("$secret:discord_bot", {
        provider: "onecli",
        gatewayUrl: "http://localhost:10255/",
      })
    ).resolves.toBe("discord-token");
  });

  it("walks nested config objects", async () => {
    process.env.TEST_SECRET_ENV = "resolved";

    await expect(
      resolveConfigSecrets({
        components: {
          discord: {
            token: "$env:TEST_SECRET_ENV",
          },
        },
      })
    ).resolves.toEqual({
      components: {
        discord: {
          token: "resolved",
        },
      },
    });
  });
});
