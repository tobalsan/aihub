import { Suspense, lazy } from "solid-js";
import type { Component, JSX } from "solid-js";
import { LeftNavShell } from "../../components/LeftNavShell";

const LazyBoardLifecycleListPage = lazy(() =>
  import("../../components/board/BoardLifecycleListPage").then((mod) => ({
    default: mod.BoardLifecycleListPage,
  }))
);
const LazyBoardView = lazy(() =>
  import("../../components/BoardView").then((mod) => ({
    default: mod.BoardView,
  }))
);
const LazyAgentsView = lazy(() =>
  import("../../components/board/AgentsView").then((mod) => ({
    default: mod.AgentsView,
  }))
);

export function BoardRouteShell(): JSX.Element {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyBoardLifecycleListPage />
      </Suspense>
    </LeftNavShell>
  );
}

export function BoardHomeRouteShell(): JSX.Element {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyBoardView />
      </Suspense>
    </LeftNavShell>
  );
}

export function BoardAgentsRouteShell(): JSX.Element {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyAgentsView />
      </Suspense>
    </LeftNavShell>
  );
}

export const webRouteExtension: {
  extensionId: string;
  home: Component;
  routes: { path: string; component: Component }[];
} = {
  extensionId: "board",
  home: BoardHomeRouteShell,
  routes: [
    { path: "/board", component: BoardRouteShell },
    { path: "/board/projects", component: BoardHomeRouteShell },
    { path: "/board/projects/:projectId", component: BoardHomeRouteShell },
    {
      path: "/board/projects/:projectId/slices/:sliceId",
      component: BoardHomeRouteShell,
    },
    { path: "/board/agents", component: BoardAgentsRouteShell },
  ],
};
