import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GatewayConfigSchema,
  resolveConfigPath,
  resolveHomeDir,
  type GatewayConfig,
  type SubagentConfig,
} from "@aihub/shared";
import { migrateConfigV1toV2 } from "./migrate.js";

export const CONFIG_DIR = resolveHomeDir();
export const SCHEDULES_PATH = path.join(CONFIG_DIR, "schedules.json");

let cachedConfig: GatewayConfig | null = null;
let singleAgentId: string | null = null;

export function getConfigPath(): string {
  return resolveConfigPath();
}

export function loadConfig(): GatewayConfig {
  if (cachedConfig) return cachedConfig;

  // Load .env file from AIHUB_HOME if it exists (silently skip if absent)
  const dotenvPath = path.join(CONFIG_DIR, ".env");
  if (fs.existsSync(dotenvPath)) {
    process.loadEnvFile(dotenvPath);
  }

  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const json = JSON.parse(raw);
  const parsed = GatewayConfigSchema.parse(json);
  const migration =
    parsed.version === undefined ? migrateConfigV1toV2(parsed) : null;
  const result = migration?.config ?? parsed;

  if (migration) {
    for (const warning of migration.warnings) {
      console.warn(`[config] ${warning}`);
    }
  }

  // Validate OneCLI CA file path at startup if configured
  if (result.onecli?.enabled && result.onecli.ca?.source === "file") {
    const caPath = result.onecli.ca.path;
    if (!fs.existsSync(caPath)) {
      throw new Error(
        `[onecli] CA file not found: ${caPath}. Check onecli.ca.path in your config.`
      );
    }
  }

  // Apply env vars from config (only if not already set in process.env)
  if (result.env) {
    for (const [key, value] of Object.entries(result.env)) {
      if (!process.env[key]?.trim()) {
        process.env[key] = value;
      }
    }
  }

  // Apply defaults
  for (const agent of result.agents) {
    if (!agent.queueMode) agent.queueMode = "queue";
    if (agent.amsg && agent.amsg.enabled === undefined) {
      agent.amsg.enabled = true;
    }
  }

  cachedConfig = result;
  return result;
}

export function reloadConfig(): GatewayConfig {
  cachedConfig = null;
  return loadConfig();
}

export function setLoadedConfig(config: GatewayConfig): void {
  cachedConfig = config;
}

export function clearConfigCacheForTests(): void {
  cachedConfig = null;
  singleAgentId = null;
}

/** Set single-agent mode - only this agent will be active */
export function setSingleAgentMode(agentId: string | null) {
  singleAgentId = agentId;
}

/** Check if agent is active (respects single-agent mode) */
export function isAgentActive(agentId: string): boolean {
  if (!singleAgentId) return true;
  return singleAgentId === agentId;
}

export function getAgent(id: string) {
  const config = loadConfig();
  return config.agents.find((a) => a.id === id);
}

export function getAgents() {
  return loadConfig().agents;
}

/** Get agents filtered by single-agent mode */
export function getActiveAgents() {
  const agents = loadConfig().agents;
  if (!singleAgentId) return agents;
  return agents.filter((a) => a.id === singleAgentId);
}

export function getSubagentTemplates(): SubagentConfig[] {
  const cfg = loadConfig();
  return cfg.subagents ?? [];
}

export function resolveWorkspaceDir(workspaceDir: string): string {
  if (workspaceDir.startsWith("~")) {
    return path.join(os.homedir(), workspaceDir.slice(1));
  }
  if (path.isAbsolute(workspaceDir)) {
    return workspaceDir;
  }
  // Resolve relative paths against the config file's parent directory
  const configDir = path.dirname(getConfigPath());
  return path.resolve(configDir, workspaceDir);
}
