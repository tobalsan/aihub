import type { Component, GatewayConfig } from "@aihub/shared";

const COMPONENT_MAP: Record<string, () => Promise<Component>> = {
  discord: () =>
    import("./discord/index.js").then((module) => module.discordComponent),
  scheduler: () =>
    import("./scheduler/index.js").then((module) => module.schedulerComponent),
  heartbeat: () =>
    import("./heartbeat/index.js").then((module) => module.heartbeatComponent),
  amsg: () => import("./amsg/index.js").then((module) => module.amsgComponent),
  conversations: () =>
    import("./conversations/index.js").then(
      (module) => module.conversationsComponent
    ),
  projects: () =>
    import("./projects/index.js").then((module) => module.projectsComponent),
};

let loadedComponents: Component[] = [];

export function topoSort(components: Component[]): Component[] {
  const ordered: Component[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(components.map((component) => [component.id, component]));

  function visit(component: Component): void {
    if (visited.has(component.id)) return;
    if (visiting.has(component.id)) {
      throw new Error(`Circular component dependency involving "${component.id}"`);
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

export async function loadComponents(config: GatewayConfig): Promise<Component[]> {
  const components: Component[] = [];

  for (const [id, loader] of Object.entries(COMPONENT_MAP)) {
    const componentConfig = config.components?.[
      id as keyof NonNullable<GatewayConfig["components"]>
    ];
    if (!componentConfig || componentConfig.enabled === false) continue;

    const component = await loader();
    const validation = component.validateConfig(componentConfig);
    if (!validation.valid) {
      throw new Error(
        `Component "${id}" config invalid: ${validation.errors.join(", ")}`
      );
    }
    components.push(component);
  }

  loadedComponents = topoSort(components);
  return loadedComponents;
}

export function getLoadedComponents(): Component[] {
  return loadedComponents;
}
