import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentConfigSchema, type AgentConfig } from "@aihub/shared";
import {
  ensureWebhookSecrets,
  getWebhookSecretsPath,
  loadWebhookSecrets,
  saveWebhookSecrets,
  webhookSecretKey,
} from "./secrets.js";

function agent(id: string, webhooks: AgentConfig["webhooks"]): AgentConfig {
  return AgentConfigSchema.parse({
    id,
    name: id,
    workspace: "/tmp",
    model: { model: "claude" },
    webhooks,
  });
}

describe("webhook secrets", () => {
  it("generates and persists missing secrets", async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "aihub-webhook-secrets-")
    );

    const result = ensureWebhookSecrets(dataDir, [
      agent("sales", { notion: { prompt: "hello", langfuseTracing: true } }),
    ]);

    const key = webhookSecretKey("sales", "notion");
    expect(result.changed).toBe(true);
    expect(result.secrets[key]).toMatch(/^[a-f0-9]{64}$/);
    await expect(fs.stat(getWebhookSecretsPath(dataDir))).resolves.toBeTruthy();
    expect(loadWebhookSecrets(dataDir)[key]).toBe(result.secrets[key]);
  });

  it("keeps existing secrets stable", async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "aihub-webhook-secrets-")
    );
    saveWebhookSecrets(dataDir, { "sales:notion": "existing" });

    const result = ensureWebhookSecrets(dataDir, [
      agent("sales", { notion: { prompt: "hello", langfuseTracing: true } }),
    ]);

    expect(result.changed).toBe(false);
    expect(result.secrets["sales:notion"]).toBe("existing");
  });
});
