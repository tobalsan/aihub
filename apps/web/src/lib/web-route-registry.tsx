import { Route } from "@solidjs/router";
import { type Component, type JSX } from "solid-js";
import { isExtensionEnabled } from "./capabilities";

type ExtensionRoute = {
  path: string;
  component: Component;
};

// Agent-keyed config route: the bespoke-route tier of the config-surface
// contract (ALG-354). An extension self-registers a config page whose `path`
// carries the `:agentId` param — mirroring the `:projectId` param used by the
// project extension routes above — and the Edit-Agent hub redirects there when
// the extension is enabled for an agent. The gateway catalog reports the same
// route (resolved) as `configRoutePath`; this registry mounts the matching
// client `<Route>` so the redirect target actually renders.
type AgentConfigRoute = {
  path: string;
  component: Component;
};

type WebRouteExtension = {
  extensionId: string;
  home?: Component;
  defaultHome?: boolean;
  routes: ExtensionRoute[];
  // Optional bespoke, agent-keyed config surface (`:agentId` param). Escape
  // hatch for custom config UI; omitted by extensions that use the schema-
  // driven auto-form or are toggle-only.
  configRoute?: AgentConfigRoute;
};

type WebRouteModule = {
  webRouteExtension?: WebRouteExtension;
};

const routeModules = import.meta.glob<WebRouteModule>("../extensions/*/routes.tsx", {
  eager: true,
});

function getExtensions(): WebRouteExtension[] {
  return Object.values(routeModules)
    .map((mod) => mod.webRouteExtension)
    .filter((extension): extension is WebRouteExtension => Boolean(extension));
}

export function getExtensionHome(extensionId: string): Component | undefined {
  const extension = getExtensions().find((item) => item.extensionId === extensionId);
  if (!extension || !isExtensionEnabled(extension.extensionId)) return undefined;
  return extension.home;
}

export function getDefaultExtensionHome(): Component | undefined {
  const extension = getExtensions().find(
    (item) => item.defaultHome && item.home && isExtensionEnabled(item.extensionId)
  );
  return extension?.home;
}

export function renderExtensionRoutes(
  wrap: (component: Component) => JSX.Element
): JSX.Element[] {
  return getExtensions()
    .filter((extension) => isExtensionEnabled(extension.extensionId))
    .flatMap((extension) => {
      const routes = extension.routes.map((route) => (
        <Route path={route.path} component={() => wrap(route.component)} />
      ));
      // Mount the bespoke agent-keyed config route too, so the hub's redirect
      // target renders. Registered alongside the extension's other routes.
      if (extension.configRoute) {
        const configRoute = extension.configRoute;
        routes.push(
          <Route
            path={configRoute.path}
            component={() => wrap(configRoute.component)}
          />
        );
      }
      return routes;
    });
}
