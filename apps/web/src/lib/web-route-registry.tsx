import { Route } from "@solidjs/router";
import { type Component, type JSX } from "solid-js";
import { isExtensionEnabled } from "./capabilities";

type ExtensionRoute = {
  path: string;
  component: Component;
};

type WebRouteExtension = {
  extensionId: string;
  home?: Component;
  defaultHome?: boolean;
  routes: ExtensionRoute[];
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
    .flatMap((extension) =>
      extension.routes.map((route) => (
        <Route path={route.path} component={() => wrap(route.component)} />
      ))
    );
}
