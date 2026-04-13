import type { Component, GatewayConfig } from "@aihub/shared";

type ComponentRegistration = {
  load: () => Promise<Component>;
  getConfig: (config: GatewayConfig) => unknown;
  routePrefixes: string[];
};

const COMPONENT_REGISTRY: Record<string, ComponentRegistration> = {
  discord: {
    load: () =>
      import("./discord/index.js").then((module) => module.discordComponent),
    getConfig: (config) => config.components?.discord,
    routePrefixes: [],
  },
  scheduler: {
    load: () =>
      import("./scheduler/index.js").then(
        (module) => module.schedulerComponent
      ),
    getConfig: (config) => config.components?.scheduler,
    routePrefixes: ["/api/schedules"],
  },
  heartbeat: {
    load: () =>
      import("./heartbeat/index.js").then(
        (module) => module.heartbeatComponent
      ),
    getConfig: (config) => config.components?.heartbeat,
    routePrefixes: ["/api/agents/:id/heartbeat"],
  },
  amsg: {
    load: () =>
      import("./amsg/index.js").then((module) => module.amsgComponent),
    getConfig: (config) => config.components?.amsg,
    routePrefixes: [],
  },
  conversations: {
    load: () =>
      import("./conversations/index.js").then(
        (module) => module.conversationsComponent
      ),
    getConfig: (config) => config.components?.conversations,
    routePrefixes: ["/api/conversations"],
  },
  projects: {
    load: () =>
      import("./projects/index.js").then((module) => module.projectsComponent),
    getConfig: (config) => config.components?.projects,
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
      import("./langfuse/index.js").then((module) => module.langfuseComponent),
    getConfig: (config) => config.components?.langfuse,
    routePrefixes: [],
  },
  multiUser: {
    load: () =>
      import("./multi-user/index.js").then(
        (module) => module.multiUserComponent
      ),
    getConfig: (config) => config.multiUser,
    routePrefixes: ["/api/auth", "/api/me", "/api/admin"],
  },
};

let loadedComponents: Component[] = [];
let loadedComponentIds = new Set<string>();

export function getKnownComponentRouteMetadata(): Array<{
  id: string;
  routePrefixes: string[];
}> {
  return Object.entries(COMPONENT_REGISTRY).map(([id, registration]) => ({
    id,
    routePrefixes: registration.routePrefixes,
  }));
}

export function topoSort(components: Component[]): Component[] {
  const ordered: Component[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(
    components.map((component) => [component.id, component])
  );

  function visit(component: Component): void {
    if (visited.has(component.id)) return;
    if (visiting.has(component.id)) {
      throw new Error(
        `Circular component dependency involving "${component.id}"`
      );
    }
    visiting.add(component.id);
    for (const dependency of component.dependencies) {
      const dependencyComponent = byId.get(dependency);
      if (!dependencyComponent) {
        throw new Error(
          `Component "${component.id}" requires "${dependency}" which is not enabled`
        );
      }
      visit(dependencyComponent);
    }
    visiting.delete(component.id);
    visited.add(component.id);
    ordered.push(component);
  }

  for (const component of components) {
    visit(component);
  }

  return ordered;
}

export async function loadComponents(
  config: GatewayConfig
): Promise<Component[]> {
  const components: Component[] = [];

  for (const [id, registration] of Object.entries(COMPONENT_REGISTRY)) {
    const componentConfig = registration.getConfig(config) as
      | { enabled?: boolean }
      | undefined;
    if (!componentConfig || componentConfig.enabled === false) continue;

    const component = await registration.load();
    const validation = component.validateConfig(componentConfig);
    if (!validation.valid) {
      throw new Error(
        `Component "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    components.push(component);
  }

  loadedComponents = topoSort(components);
  loadedComponentIds = new Set(
    loadedComponents.map((component) => component.id)
  );
  return loadedComponents;
}

export function getLoadedComponents(): Component[] {
  return loadedComponents;
}

export function isMultiUserLoaded(): boolean {
  return loadedComponentIds.has("multiUser");
}

export function isComponentLoaded(componentId: string): boolean {
  return loadedComponentIds.has(componentId);
}
