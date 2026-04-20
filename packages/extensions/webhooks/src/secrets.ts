import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig } from "@aihub/shared";

export type WebhookSecrets = Record<string, string>;

const SECRET_FILE = "webhook-secrets.json";

export function webhookSecretKey(agentId: string, webhookName: string): string {
  return `${agentId}:${webhookName}`;
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getWebhookSecretsPath(dataDir: string): string {
  return path.join(dataDir, SECRET_FILE);
}

export function loadWebhookSecrets(dataDir: string): WebhookSecrets {
  const filePath = getWebhookSecretsPath(dataDir);
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${SECRET_FILE} must contain a JSON object`);
  }

  const secrets: WebhookSecrets = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`${SECRET_FILE} value for ${key} must be a string`);
    }
    secrets[key] = value;
  }
  return secrets;
}

export function saveWebhookSecrets(
  dataDir: string,
  secrets: WebhookSecrets
): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    getWebhookSecretsPath(dataDir),
    `${JSON.stringify(secrets, null, 2)}\n`,
    "utf8"
  );
}

export function ensureWebhookSecrets(
  dataDir: string,
  agents: AgentConfig[]
): { secrets: WebhookSecrets; changed: boolean } {
  const secrets = loadWebhookSecrets(dataDir);
  let changed = false;

  for (const agent of agents) {
    for (const webhookName of Object.keys(agent.webhooks ?? {})) {
      const key = webhookSecretKey(agent.id, webhookName);
      if (secrets[key]) continue;
      secrets[key] = generateWebhookSecret();
      changed = true;
    }
  }

  if (changed) saveWebhookSecrets(dataDir, secrets);
  return { secrets, changed };
}
