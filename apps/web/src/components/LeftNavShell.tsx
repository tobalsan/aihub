import { Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { AgentSidebar } from "./AgentSidebar";
import {
  sidebarCollapsed,
  setSidebarCollapsedPersistent,
  toggleSidebarCollapsed,
  zenMode,
} from "../lib/layout";

export function LeftNavShell(props: { children?: JSX.Element }) {
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = (matches: boolean) => setIsMobile(matches);
    update(media.matches);
    const handler = (event: MediaQueryListEvent) => update(event.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      onCleanup(() => media.removeEventListener("change", handler));
    } else {
      media.addListener(handler);
      onCleanup(() => media.removeListener(handler));
    }
  });

  createEffect(
    on(
      isMobile,
      (mobile) => {
        if (mobile) setSidebarCollapsedPersistent(true);
      },
      { defer: true }
    )
  );

  return (
    <div class="left-nav-shell" classList={{ "zen-mode": zenMode() }}>
      <Show when={!zenMode()}>
        <AgentSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </Show>
      <Show when={isMobile() && !zenMode()}>
        <button
          class="mobile-sidebar-toggle"
          type="button"
          onClick={toggleSidebarCollapsed}
          aria-label="Toggle sidebar"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </Show>
      <div class="left-nav-main">{props.children}</div>
      <style>{`
        .left-nav-shell {
          height: 100%;
          display: flex;
          width: 100%;
          position: relative;
          min-height: 0;
          overscroll-behavior: contain;
        }

        .left-nav-main {
          flex: 1;
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .left-nav-shell.zen-mode .left-nav-main {
          width: 100%;
        }

        .left-nav-shell .mobile-sidebar-toggle {
          position: fixed;
          top: 14px;
          left: 12px;
          z-index: 900;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .left-nav-shell .mobile-sidebar-toggle svg {
          width: 18px;
          height: 18px;
        }

        @media (min-width: 769px) {
          .left-nav-shell .mobile-sidebar-toggle {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
