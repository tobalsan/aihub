import path from "node:path";
import type { Extension, GatewayConfig } from "@aihub/shared";
import { discoverExternalExtensions } from "@aihub/shared";
import { CONFIG_DIR } from "../config/index.js";
import { ExtensionRuntime } from "./runtime.js";

type ExtensionRegistration = {
  load: () => Promise<Extension>;
  getConfig: (config: GatewayConfig) => unknown;
  routePrefixes: string[];
};

const EXTENSION_LOAD_PRIORITY: Record<string, number> = {
  webhooks: -10,
  subagents: -5,
  discord: 10,
  slack: 10,
};

const EXTENSION_REGISTRY: Record<string, ExtensionRegistration> = {
  discord: {
    load: () =>
      import("@aihub/extension-discord").then(
        (module) => module.discordExtension
      ),
    getConfig: (config) => {
      const hasPerAgent = config.agents?.some((a) => a.discord?.token);
      if (config.extensions?.discord) {
        return { ...config.extensions.discord, _perAgentFallback: hasPerAgent };
      }
      return hasPerAgent ? { _perAgent: true } : undefined;
    },
    routePrefixes: [],
  },
  slack: {
    load: () =>
      import("@aihub/extension-slack").then((module) => module.slackExtension),
    getConfig: (config) => {
      const hasPerAgent = config.agents?.some((a) => a.slack?.token);
      if (config.extensions?.slack) {
        return { ...config.extensions.slack, _perAgentFallback: hasPerAgent };
      }
      return hasPerAgent ? { _perAgent: true } : undefined;
    },
    routePrefixes: [],
  },
  scheduler: {
    load: () =>
      import("@aihub/extension-scheduler").then(
        (module) => module.schedulerExtension
      ),
    getConfig: (config) => config.extensions?.scheduler,
    routePrefixes: ["/api/schedules"],
  },
  heartbeat: {
    load: () =>
      import("@aihub/extension-heartbeat").then(
        (module) => module.heartbeatExtension
      ),
    getConfig: (config) => config.extensions?.heartbeat,
    routePrefixes: ["/api/agents/:id/heartbeat"],
  },
  projects: {
    load: () =>
      import("@aihub/extension-projects").then(
        (module) => module.projectsExtension
      ),
    getConfig: (config) => config.extensions?.projects,
    routePrefixes: [
      "/api/areas",
      "/api/projects",
      "/api/activity",
      "/api/taskboard",
    ],
  },
  subagents: {
    load: () =>
      import("@aihub/extension-subagents").then(
        (module) => module.subagentsExtension
      ),
    getConfig: (config) => config.extensions?.subagents,
    routePrefixes: ["/api/subagents"],
  },
  langfuse: {
    load: () =>
      import("@aihub/extension-langfuse").then(
        (module) => module.langfuseExtension
      ),
    getConfig: (config) => config.extensions?.langfuse,
    routePrefixes: [],
  },
  webhooks: {
    load: () =>
      import("@aihub/extension-webhooks").then(
        (module) => module.webhooksExtension
      ),
    getConfig: (config) => {
      const hasWebhooks = config.agents?.some(
        (agent) => agent.webhooks && Object.keys(agent.webhooks).length > 0
      );
      return hasWebhooks ? { _perAgent: true } : undefined;
    },
    routePrefixes: ["/hooks"],
  },
  multiUser: {
    load: () =>
      import("@aihub/extension-multi-user").then(
        (module) => module.multiUserExtension
      ),
    getConfig: (config) => config.extensions?.multiUser,
    routePrefixes: ["/api/auth", "/api/me", "/api/admin"],
  },
  board: {
    load: () =>
      import("@aihub/extension-board").then((module) => module.boardExtension),
    getConfig: (config) => config.extensions?.board,
    routePrefixes: ["/api/board"],
  },
};

const BUILT_IN_DEFAULTS = new Set(["heartbeat", "scheduler"]);

const extensionRuntime = new ExtensionRuntime(getKnownExtensionRouteMetadata());

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getRootExtensionConfig(
  config: GatewayConfig,
  id: string
): Record<string, unknown> | undefined {
  const extensions = config.extensions as Record<string, unknown> | undefined;
  const value = extensions?.[id];
  if (value === undefined) return undefined;
  return toRecord(value);
}

function hasEnabledAgentExtensionConfig(
  config: GatewayConfig,
  id: string
): boolean {
  return config.agents.some((agent) => {
    const extensions = agent.extensions as Record<string, unknown> | undefined;
    if (!extensions || !(id in extensions)) return false;
    return toRecord(extensions[id]).enabled !== false;
  });
}

export function getKnownExtensionRouteMetadata(): Array<{
  id: string;
  routePrefixes: string[];
}> {
  return Object.entries(EXTENSION_REGISTRY).map(([id, registration]) => ({
    id,
    routePrefixes: registration.routePrefixes,
  }));
}

export function topoSort(extensions: Extension[]): Extension[] {
  const ordered: Extension[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(
    extensions.map((extension) => [extension.id, extension])
  );

  function visit(extension: Extension): void {
    if (visited.has(extension.id)) return;
    if (visiting.has(extension.id)) {
      throw new Error(
        `Circular extension dependency involving "${extension.id}"`
      );
    }
    visiting.add(extension.id);
    for (const dependency of extension.dependencies) {
      const dependencyExtension = byId.get(dependency);
      if (!dependencyExtension) {
        throw new Error(
          `Extension "${extension.id}" requires "${dependency}" which is not enabled`
        );
      }
      visit(dependencyExtension);
    }
    visiting.delete(extension.id);
    visited.add(extension.id);
    ordered.push(extension);
  }

  for (const extension of extensions) {
    visit(extension);
  }

  return ordered;
}

export async function loadExtensions(
  config: GatewayConfig
): Promise<Extension[]> {
  const extensions: Extension[] = [];
  const rawConfigs = new Map<string, Record<string, unknown>>();

  const registrations = Object.entries(EXTENSION_REGISTRY).sort(
    ([leftId], [rightId]) =>
      (EXTENSION_LOAD_PRIORITY[leftId] ?? 0) -
      (EXTENSION_LOAD_PRIORITY[rightId] ?? 0)
  );

  for (const [id, registration] of registrations) {
    const extensionConfig = toRecord(registration.getConfig(config));
    const hasConfig = registration.getConfig(config) !== undefined;

    // Skip if explicitly disabled
    if (extensionConfig?.enabled === false) continue;

    // Skip non-defaults that have no config
    const isDefault = BUILT_IN_DEFAULTS.has(id);
    if (!hasConfig && !isDefault) continue;

    const extension = await registration.load();
    // For defaults with no config, pass empty object; validateConfig should accept it
    const configToValidate = hasConfig ? extensionConfig : {};
    const validation = extension.validateConfig(configToValidate);
    if (!validation.valid) {
      throw new Error(
        `Extension "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    extensions.push(extension);
    rawConfigs.set(id, configToValidate);
  }

  // Discover external extensions
  const extensionsPath =
    config.extensionsPath ?? path.join(CONFIG_DIR, "extensions");
  const external = await discoverExternalExtensions(extensionsPath);
  for (const { extension, id } of external) {
    if (EXTENSION_REGISTRY[id]) {
      throw new Error(
        `External extension "${id}" conflicts with a built-in extension id`
      );
    }
    if (extensions.some((candidate) => candidate.id === id)) {
      throw new Error(`Duplicate extension id "${id}"`);
    }

    const extensionConfig = getRootExtensionConfig(config, id);
    const hasAgentConfig = hasEnabledAgentExtensionConfig(config, id);
    if (extensionConfig?.enabled === false) continue;
    if (!extensionConfig && !hasAgentConfig) {
      continue;
    }

    const configToValidate = extensionConfig ?? {};
    const validation = extension.validateConfig(configToValidate);
    if (!validation.valid) {
      throw new Error(
        `Extension "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    extensions.push(extension);
    rawConfigs.set(id, configToValidate);
  }

  const loadedExtensions = topoSort(extensions);
  const loadedExtensionIds = new Set(
    loadedExtensions.map((extension) => extension.id)
  );

  // Resolve home route ownership
  // Parse each extension's raw config through its own configSchema to resolve defaults
  const homeClaimants = loadedExtensions.filter((extension) => {
    const raw = rawConfigs.get(extension.id);
    if (!raw) return false;
    try {
      const parsed = extension.configSchema.parse(raw) as Record<
        string,
        unknown
      >;
      return parsed.home === true;
    } catch {
      return false;
    }
  });
  if (homeClaimants.length > 1) {
    const names = homeClaimants.map((e) => `"${e.id}"`).join(", ");
    throw new Error(
      `Multiple extensions claim home route: ${names}. Only one extension can have home: true.`
    );
  }
  const homeExtensionId = homeClaimants[0]?.id;

  for (const agent of config.agents) {
    const agentExtensions = agent.extensions as
      | Record<string, unknown>
      | undefined;
    if (!agentExtensions) continue;
    for (const [id, value] of Object.entries(agentExtensions)) {
      if (toRecord(value).enabled === false) continue;
      if (!loadedExtensionIds.has(id)) {
        console.warn(
          `[extensions] agent "${agent.id}" references unknown extension "${id}"`
        );
      }
    }
  }

  extensionRuntime.load(loadedExtensions, homeExtensionId);
  return extensionRuntime.getLoadedExtensions();
}

export function getLoadedExtensions(): Extension[] {
  return extensionRuntime.getLoadedExtensions();
}

export function isMultiUserLoaded(): boolean {
  return extensionRuntime.isMultiUserEnabled();
}

export function isExtensionLoaded(extensionId: string): boolean {
  return extensionRuntime.isEnabled(extensionId);
}

export function getHomeExtension(): string | undefined {
  return extensionRuntime.getHomeExtension();
}

export function getExtensionRuntime(): ExtensionRuntime {
  return extensionRuntime;
}

export function createExtensionRuntime(
  extensions: Extension[],
  homeExtensionId?: string
): ExtensionRuntime {
  const runtime = new ExtensionRuntime(getKnownExtensionRouteMetadata());
  runtime.load(extensions, homeExtensionId);
  return runtime;
}
