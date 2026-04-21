import path from "node:path";
import type { Extension, GatewayConfig } from "@aihub/shared";
import { discoverExternalExtensions } from "@aihub/shared";
import { CONFIG_DIR } from "../config/index.js";

type ExtensionRegistration = {
  load: () => Promise<Extension>;
  getConfig: (config: GatewayConfig) => unknown;
  routePrefixes: string[];
};

const EXTENSION_LOAD_PRIORITY: Record<string, number> = {
  webhooks: -10,
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
      "/api/subagents",
      "/api/activity",
      "/api/taskboard",
    ],
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
};

const BUILT_IN_DEFAULTS = new Set(["heartbeat", "scheduler"]);

let loadedExtensions: Extension[] = [];
let loadedExtensionIds = new Set<string>();

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

  const registrations = Object.entries(EXTENSION_REGISTRY).sort(
    ([leftId], [rightId]) =>
      (EXTENSION_LOAD_PRIORITY[leftId] ?? 0) -
      (EXTENSION_LOAD_PRIORITY[rightId] ?? 0)
  );

  for (const [id, registration] of registrations) {
    const extensionConfig = registration.getConfig(config) as
      | { enabled?: boolean }
      | undefined;

    // Skip if explicitly disabled
    if (extensionConfig?.enabled === false) continue;

    // Skip non-defaults that have no config
    const isDefault = BUILT_IN_DEFAULTS.has(id);
    if (!extensionConfig && !isDefault) continue;

    const extension = await registration.load();
    // For defaults with no config, pass empty object; validateConfig should accept it
    const configToValidate = extensionConfig ?? {};
    const validation = extension.validateConfig(configToValidate);
    if (!validation.valid) {
      throw new Error(
        `Extension "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    extensions.push(extension);
  }

  // Discover external extensions
  const extensionsPath =
    (config as GatewayConfig & { extensionsPath?: string }).extensionsPath ??
    path.join(CONFIG_DIR, "extensions");
  const external = await discoverExternalExtensions(extensionsPath);
  for (const { extension, id } of external) {
    const extensionConfig = (
      config.extensions as Record<string, unknown> | undefined
    )?.[id];
    if (
      !extensionConfig ||
      (extensionConfig as { enabled?: boolean }).enabled === false
    )
      continue;

    const validation = extension.validateConfig(extensionConfig);
    if (!validation.valid) {
      throw new Error(
        `Extension "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    extensions.push(extension);
  }

  loadedExtensions = topoSort(extensions);
  loadedExtensionIds = new Set(
    loadedExtensions.map((extension) => extension.id)
  );
  return loadedExtensions;
}

export function getLoadedExtensions(): Extension[] {
  return loadedExtensions;
}

export function isMultiUserLoaded(): boolean {
  return loadedExtensionIds.has("multiUser");
}

export function isExtensionLoaded(extensionId: string): boolean {
  return loadedExtensionIds.has(extensionId);
}
