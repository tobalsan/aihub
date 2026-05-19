import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fg from "fast-glob";
import yaml from "js-yaml";
import {
  AgentYamlConfigSchema,
  GatewayRootConfigSchema,
  resolveConfigPath,
  resolveHomeDir,
  type AgentConfig,
  type GatewayConfig,
  type SubagentConfig,
} from "@aihub/shared";

export const CONFIG_DIR = resolveHomeDir();
export const SCHEDULES_PATH = path.join(CONFIG_DIR, "schedules.json");

let cachedConfig: GatewayConfig | null = null;
let singleAgentId: string | null = null;

export function getConfigPath(): string {
  return resolveConfigPath();
}

function resolvePathFromConfig(input: string, configDir: string): string {
  const expanded = input.startsWith("~")
    ? path.join(os.homedir(), input.slice(1))
    : input.replace(/^\$AIHUB_HOME(?=\/|$)/, CONFIG_DIR);
  return path.isAbsolute(expanded) ? expanded : path.resolve(configDir, expanded);
}

function hasGlobMagic(input: string): boolean {
  return /[*?[\]{}]/.test(input);
}

function globToDirs(pattern: string, configDir: string): string[] {
  const resolved = resolvePathFromConfig(pattern, configDir);
  if (!hasGlobMagic(pattern)) return [resolved];
  return fg.sync(resolved, {
    absolute: true,
    dot: true,
    onlyDirectories: true,
    unique: true,
  });
}

function discoverAgents(agentGlobs: string | string[] | undefined, configDir: string): AgentConfig[] {
  const patterns = typeof agentGlobs === "string" ? [agentGlobs] : agentGlobs ?? [];
  const agents: AgentConfig[] = [];
  const seen = new Map<string, string>();

  for (const pattern of patterns) {
    for (const workspaceDir of globToDirs(pattern, configDir)) {
      const agentPath = path.join(workspaceDir, "agent.yaml");
      if (!fs.existsSync(agentPath)) {
        console.warn(`[config] no agent.yaml in ${workspaceDir}; skipping`);
        continue;
      }
      let parsedYaml: unknown;
      try {
        parsedYaml = yaml.load(fs.readFileSync(agentPath, "utf8"));
      } catch (error) {
        console.warn(`[config] failed to read ${agentPath}: ${(error as Error).message}`);
        continue;
      }
      const parsed = AgentYamlConfigSchema.safeParse(parsedYaml);
      if (!parsed.success) {
        console.warn(`[config] invalid ${agentPath}: ${parsed.error.message}`);
        continue;
      }
      const folderName = path.basename(workspaceDir);
      if (parsed.data.id !== folderName) {
        throw new Error(`agent.yaml id mismatch in ${agentPath}: id "${parsed.data.id}" must match folder "${folderName}"`);
      }
      const duplicate = seen.get(parsed.data.id);
      if (duplicate) {
        throw new Error(`Duplicate agent id "${parsed.data.id}" in ${duplicate} and ${agentPath}`);
      }
      seen.set(parsed.data.id, agentPath);
      agents.push({ ...parsed.data, workspace: workspaceDir, workspaceDir });
    }
  }

  return agents.sort((a, b) => a.id.localeCompare(b.id));
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
  if (
    json.version !== 3 ||
    (Array.isArray(json.agents) &&
      json.agents.some(
        (agent: unknown) => typeof agent === "object" && agent !== null
      ))
  ) {
    throw new Error("aihub.json is version 2. Run `aihub agents migrate` to upgrade to version 3.");
  }
  const parsed = GatewayRootConfigSchema.parse(json);
  const configDir = path.dirname(configPath);
  const result: GatewayConfig = {
    ...parsed,
    version: 3,
    agents: discoverAgents(parsed.agents as string | string[] | undefined, configDir),
  };

  // Validate OneCLI CA file path at startup if configured
  if (result.onecli?.enabled && result.onecli.ca?.source === "file") {
    result.onecli.ca.path = result.onecli.ca.path.replace(
      /^~/,
      os.homedir()
    );
    if (!fs.existsSync(result.onecli.ca.path)) {
      console.warn(
        `[onecli] CA file not found: ${result.onecli.ca.path}. OneCLI proxy may fail until the CA is installed.`
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
