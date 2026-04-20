import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  GatewayConfigSchema,
  resolveBindHost,
  resolveHomeDir,
} from "@aihub/shared";

type WebhookSecrets = Record<string, string>;

type RotateWebhookSecretParams = {
  agentId: string;
  webhookName: string;
  dataDir?: string;
  baseUrl?: string;
};

type RotateWebhookSecretResult = {
  key: string;
  secret: string;
  url: string;
};

const SECRET_FILE = "webhook-secrets.json";
const SECRET_FILE_MODE = 0o600;

function webhookSecretKey(agentId: string, webhookName: string): string {
  return `${agentId}:${webhookName}`;
}

function getWebhookSecretsPath(dataDir: string): string {
  return path.join(dataDir, SECRET_FILE);
}

function loadWebhookSecrets(dataDir: string): WebhookSecrets {
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

function saveWebhookSecrets(dataDir: string, secrets: WebhookSecrets): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = getWebhookSecretsPath(dataDir);
  fs.writeFileSync(filePath, `${JSON.stringify(secrets, null, 2)}\n`, {
    encoding: "utf8",
    mode: SECRET_FILE_MODE,
  });
  fs.chmodSync(filePath, SECRET_FILE_MODE);
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function getWebhookBaseUrl(dataDir: string): string {
  const envUrl = process.env.AIHUB_API_URL ?? process.env.AIHUB_URL;
  if (envUrl?.trim()) return trimTrailingSlash(envUrl.trim());

  try {
    const raw = fs.readFileSync(path.join(dataDir, "aihub.json"), "utf8");
    const parsed = JSON.parse(raw) as { apiUrl?: unknown };
    if (typeof parsed.apiUrl === "string" && parsed.apiUrl.trim()) {
      return trimTrailingSlash(parsed.apiUrl.trim());
    }
    const config = GatewayConfigSchema.parse(parsed);
    if (config.server?.baseUrl) return trimTrailingSlash(config.server.baseUrl);
    const host = config.gateway?.host ?? resolveBindHost(config.gateway?.bind);
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    const port = config.gateway?.port ?? 4000;
    return `http://${displayHost}:${port}`;
  } catch {
    return "http://localhost:4000";
  }
}

export function rotateWebhookSecret(
  params: RotateWebhookSecretParams
): RotateWebhookSecretResult {
  const dataDir = params.dataDir ?? resolveHomeDir();
  const baseUrl = trimTrailingSlash(
    params.baseUrl ?? getWebhookBaseUrl(dataDir)
  );
  const secrets = loadWebhookSecrets(dataDir);
  const key = webhookSecretKey(params.agentId, params.webhookName);

  if (!Object.hasOwn(secrets, key)) {
    throw new Error(
      `Webhook secret not found for ${key} in ${getWebhookSecretsPath(dataDir)}`
    );
  }

  const secret = generateWebhookSecret();
  secrets[key] = secret;
  saveWebhookSecrets(dataDir, secrets);

  return {
    key,
    secret,
    url: `${baseUrl}/hooks/${params.agentId}/${params.webhookName}/${secret}`,
  };
}

export function registerWebhookCommands(program: Command): void {
  const webhooks = program.command("webhooks").description("Manage webhooks");

  webhooks
    .command("rotate")
    .description("Rotate a webhook secret")
    .argument("<agent_id>", "Agent ID")
    .argument("<webhook_name>", "Webhook name")
    .action((agentId: string, webhookName: string) => {
      try {
        const result = rotateWebhookSecret({ agentId, webhookName });
        console.log(`New URL: ${result.url}`);
        console.log("Old URL is immediately invalid.");
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
