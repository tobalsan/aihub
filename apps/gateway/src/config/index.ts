import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayConfigSchema, type GatewayConfig } from "@aihub/shared";

export const CONFIG_DIR = path.join(os.homedir(), ".aihub");
export const CONFIG_PATH = path.join(CONFIG_DIR, "aihub.json");
export const SCHEDULES_PATH = path.join(CONFIG_DIR, "schedules.json");

let cachedConfig: GatewayConfig | null = null;
let singleAgentId: string | null = null;

export function loadConfig(): GatewayConfig {
  if (cachedConfig) return cachedConfig;

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const json = JSON.parse(raw);
  const result = GatewayConfigSchema.parse(json);

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

export function resolveWorkspaceDir(workspaceDir: string): string {
  if (workspaceDir.startsWith("~")) {
    return path.join(os.homedir(), workspaceDir.slice(1));
  }
  return path.resolve(workspaceDir);
}
