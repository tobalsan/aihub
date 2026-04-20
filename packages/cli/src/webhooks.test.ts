import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rotateWebhookSecret } from "./webhooks.js";

async function readSecrets(dataDir: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(
    path.join(dataDir, "webhook-secrets.json"),
    "utf8"
  );
  return JSON.parse(raw) as Record<string, string>;
}

describe("apm webhooks", () => {
  it("rotates an existing webhook secret", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "apm-webhooks-"));
    await fs.writeFile(
      path.join(dataDir, "webhook-secrets.json"),
      JSON.stringify({ "sales:notion": "old-secret" }),
      "utf8"
    );

    const result = rotateWebhookSecret({
      agentId: "sales",
      webhookName: "notion",
      dataDir,
      baseUrl: "http://localhost:4000/",
    });

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.secret).not.toBe("old-secret");
    expect(result.url).toBe(
      `http://localhost:4000/hooks/sales/notion/${result.secret}`
    );
    expect(await readSecrets(dataDir)).toEqual({
      "sales:notion": result.secret,
    });
  });

  it("errors when the webhook secret is missing", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "apm-webhooks-"));

    expect(() =>
      rotateWebhookSecret({
        agentId: "sales",
        webhookName: "notion",
        dataDir,
        baseUrl: "http://localhost:4000",
      })
    ).toThrow(/Webhook secret not found for sales:notion/);
  });
});
