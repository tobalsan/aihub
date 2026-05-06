import type { Extension, GatewayConfig } from "@aihub/shared";
import {
  loadConfig,
  getAgent,
  setSingleAgentMode,
  setLoadedConfig,
} from "../config/index.js";
import { startServer } from "../server/index.js";
import { api } from "../server/api.core.js";
import {
  getExtensionRuntime,
  loadExtensions,
} from "../extensions/registry.js";
import { createExtensionContext } from "../extensions/context.js";
import {
  prepareStartupConfig,
  logComponentSummary,
  resolveStartupConfig,
} from "../config/validate.js";

export type GatewayCommandOptions = {
  port?: string;
  host?: string;
  agentId?: string;
  dev?: boolean;
};

export type StartedGateway = {
  actualPort: number;
  config: GatewayConfig;
  extensions: Extension[];
  uiEnabled: boolean;
  uiPort: number;
};

export async function startGatewayCommand(
  opts: GatewayCommandOptions
): Promise<StartedGateway> {
  const rawConfig = loadConfig();
  const resolvedStartupConfig = await resolveStartupConfig(rawConfig);
  const extensions = await loadExtensions(resolvedStartupConfig);
  const extensionRuntime = getExtensionRuntime();
  const { resolvedConfig: config, summary } = await prepareStartupConfig(
    rawConfig,
    extensions,
    { resolvedConfig: resolvedStartupConfig }
  );
  logComponentSummary(summary);
  setLoadedConfig(config);

  console.log(`Loaded config with ${config.agents.length} agent(s)`);

  if (opts.agentId) {
    const agent = getAgent(opts.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${opts.agentId}`);
    }
    setSingleAgentMode(opts.agentId);
    console.log(`Single-agent mode: ${agent.name} (${agent.id})`);
  }

  if (opts.dev) {
    process.env.AIHUB_DEV = "1";
  }

  for (const extension of extensions) {
    extension.registerRoutes(api);
  }

  const port = opts.port ? parseInt(opts.port, 10) : undefined;
  const actualPort = port ?? config.gateway?.port ?? 4000;
  const uiPort = process.env.AIHUB_UI_PORT
    ? parseInt(process.env.AIHUB_UI_PORT, 10)
    : (config.ui?.port ?? 3000);
  const runtimeConfig = {
    ...config,
    gateway: { ...config.gateway, port: actualPort },
    ui: { ...config.ui, port: uiPort },
  };
  const extensionContext = createExtensionContext(runtimeConfig);
  for (const extension of extensions) {
    await extension.start(extensionContext);
  }

  startServer(port, opts.host, extensionRuntime);

  return {
    actualPort,
    config,
    extensions,
    uiEnabled: config.ui?.enabled !== false,
    uiPort,
  };
}
