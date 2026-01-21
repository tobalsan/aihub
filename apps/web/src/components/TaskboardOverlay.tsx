import { createSignal, createEffect, createMemo, onCleanup, Show, For } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { fetchTaskboard, fetchTaskboardItem } from "../api/client";
import type { TodoItem, ProjectItem, TaskboardItemResponse } from "../api/types";

type TaskboardItem = TodoItem | ProjectItem;
type NavigableItem = { type: "todo" | "project"; item: TaskboardItem };

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}

function extractId(id: string): string {
  const match = id.match(/(PER|PRO)-\d+/);
  return match ? match[0] : id;
}

export function TaskboardOverlay(props: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [todos, setTodos] = createSignal<{ todo: TodoItem[]; doing: TodoItem[] }>({ todo: [], doing: [] });
  const [projects, setProjects] = createSignal<{ todo: ProjectItem[]; doing: ProjectItem[] }>({ todo: [], doing: [] });

  // Detail view state
  const [selectedItem, setSelectedItem] = createSignal<{ type: "todo" | "project"; item: TaskboardItem } | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detail, setDetail] = createSignal<TaskboardItemResponse | null>(null);
  const [activeTab, setActiveTab] = createSignal<string>("main");

  // Keyboard navigation state
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  // Build flat list of all navigable items in display order
  const navigableItems = createMemo((): NavigableItem[] => {
    const items: NavigableItem[] = [];
    // Personal todos
    for (const item of todos().todo) {
      items.push({ type: "todo", item });
    }
    // Projects - doing first, then todo
    for (const item of projects().doing) {
      items.push({ type: "project", item });
    }
    for (const item of projects().todo) {
      items.push({ type: "project", item });
    }
    return items;
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchTaskboard();
    if (result.ok) {
      setTodos(result.data.todos);
      setProjects(result.data.projects);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const loadDetail = async (type: "todo" | "project", id: string, companion?: string) => {
    setDetailLoading(true);
    const result = await fetchTaskboardItem(type, id, companion);
    if (result.ok) {
      setDetail(result.data);
    }
    setDetailLoading(false);
  };

  const handleItemClick = async (type: "todo" | "project", item: TaskboardItem) => {
    setSelectedItem({ type, item });
    setActiveTab("main");
    await loadDetail(type, item.id);
  };

  const handleBack = () => {
    setSelectedItem(null);
    setDetail(null);
    setActiveTab("main");
  };

  const handleTabChange = async (tab: string) => {
    setActiveTab(tab);
    const selected = selectedItem();
    if (!selected) return;
    await loadDetail(selected.type, selected.item.id, tab === "main" ? undefined : tab);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (selectedItem()) {
        handleBack();
      } else {
        props.onClose();
      }
      return;
    }

    // Only handle arrow/enter in list view
    if (selectedItem()) return;

    const items = navigableItems();
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter" && selectedIndex() >= 0) {
      e.preventDefault();
      const selected = items[selectedIndex()];
      handleItemClick(selected.type, selected.item);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      setSelectedIndex(-1);
      loadData();
      document.addEventListener("keydown", handleKeyDown);
    }
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  const isProjectItem = (item: TaskboardItem): item is ProjectItem => {
    return "companions" in item;
  };

  // Check if an item is currently selected via keyboard
  const isItemSelected = (type: "todo" | "project", item: TaskboardItem): boolean => {
    const idx = selectedIndex();
    if (idx < 0) return false;
    const items = navigableItems();
    const navItem = items[idx];
    return navItem?.type === type && navItem.item.id === item.id;
  };

  return (
    <Show when={props.isOpen}>
      <div class="taskboard-overlay">
        <div class="taskboard-container">
          <header class="taskboard-header">
            <Show when={selectedItem()}>
              <button class="back-btn" onClick={handleBack} aria-label="Go back">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
            </Show>
            <h1 class="taskboard-title">{selectedItem() ? detail()?.title ?? "Loading..." : "Tasks"}</h1>
            <button class="close-btn" onClick={props.onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div class="taskboard-content">
            <Show when={loading()}>
              <div class="loading">Loading...</div>
            </Show>

            <Show when={error()}>
              <div class="error-message">{error()}</div>
            </Show>

            <Show when={!loading() && !error() && !selectedItem()}>
              {/* List View */}
              <div class="taskboard-list">
                {/* Personal Todos */}
                <section class="section">
                  <h2 class="section-header">Personal</h2>
                  <Show when={todos().todo.length === 0}>
                    <div class="no-items">No items</div>
                  </Show>
                  <div class="items-group">
                    <For each={todos().todo}>
                      {(item) => (
                        <button class="task-item" classList={{ selected: isItemSelected("todo", item) }} onClick={() => handleItemClick("todo", item)}>
                          <span class="task-id">{extractId(item.id)}</span>
                          <span class="task-title">{item.title}</span>
                          <span class="task-badge todo">todo</span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>

                {/* Projects */}
                <section class="section">
                  <h2 class="section-header">Projects</h2>
                  <Show when={projects().doing.length === 0 && projects().todo.length === 0}>
                    <div class="no-items">No items</div>
                  </Show>

                  <Show when={projects().doing.length > 0}>
                    <h3 class="status-header">Doing</h3>
                    <div class="items-group">
                      <For each={projects().doing}>
                        {(item) => (
                          <button class="task-item" classList={{ selected: isItemSelected("project", item) }} onClick={() => handleItemClick("project", item)}>
                            <span class="task-id">{extractId(item.id)}</span>
                            <span class="task-title">{item.title}</span>
                            <span class="task-badge doing">doing</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={projects().todo.length > 0}>
                    <h3 class="status-header">Todo</h3>
                    <div class="items-group">
                      <For each={projects().todo}>
                        {(item) => (
                          <button class="task-item" classList={{ selected: isItemSelected("project", item) }} onClick={() => handleItemClick("project", item)}>
                            <span class="task-id">{extractId(item.id)}</span>
                            <span class="task-title">{item.title}</span>
                            <span class="task-badge todo">todo</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </div>
            </Show>

            <Show when={selectedItem() && !detailLoading() && detail()}>
              {/* Detail View */}
              <div class="taskboard-detail">
                {/* Tab bar for projects with companions */}
                <Show when={selectedItem()?.type === "project" && isProjectItem(selectedItem()!.item) && (selectedItem()!.item as ProjectItem).companions.length > 0}>
                  <div class="tab-bar">
                    <button
                      class="tab-btn"
                      classList={{ active: activeTab() === "main" }}
                      onClick={() => handleTabChange("main")}
                    >
                      Main
                    </button>
                    <For each={(selectedItem()!.item as ProjectItem).companions}>
                      {(companion) => (
                        <button
                          class="tab-btn"
                          classList={{ active: activeTab() === companion }}
                          onClick={() => handleTabChange(companion)}
                        >
                          {companion.charAt(0).toUpperCase() + companion.slice(1)}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="detail-content markdown-content" innerHTML={renderMarkdown(detail()!.content)} />
              </div>
            </Show>

            <Show when={detailLoading()}>
              <div class="loading">Loading...</div>
            </Show>
          </div>
        </div>

        <style>{`
          .taskboard-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--surface-0, #09090b);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            animation: fadeIn 0.2s ease-out;
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          .taskboard-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            max-width: 800px;
            width: 100%;
            margin: 0 auto;
            height: 100%;
          }

          .taskboard-header {
            display: flex;
            align-items: center;
            padding: 16px 20px;
            gap: 16px;
            border-bottom: 1px solid var(--surface-2, #27272a);
            flex-shrink: 0;
          }

          .taskboard-title {
            flex: 1;
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary, #fafafa);
            margin: 0;
          }

          .back-btn,
          .close-btn {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            background: var(--surface-1, #18181b);
            border: 1px solid var(--surface-2, #27272a);
            color: var(--text-secondary, #a1a1aa);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .back-btn:hover,
          .close-btn:hover {
            background: var(--surface-2, #27272a);
            color: var(--text-primary, #fafafa);
          }

          .taskboard-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px 20px;
          }

          .loading {
            text-align: center;
            color: var(--text-muted, #52525b);
            padding: 40px;
          }

          .error-message {
            text-align: center;
            color: var(--error, #ef4444);
            padding: 40px;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 8px;
            margin: 20px;
          }

          .section {
            margin-bottom: 32px;
          }

          .section-header {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted, #52525b);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 0 0 12px 0;
          }

          .status-header {
            font-size: 11px;
            font-weight: 500;
            color: var(--text-muted, #52525b);
            margin: 16px 0 8px 0;
          }

          .no-items {
            color: var(--text-muted, #52525b);
            font-size: 14px;
            padding: 12px 0;
          }

          .items-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .task-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: var(--surface-1, #18181b);
            border: 1px solid var(--surface-2, #27272a);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: left;
            width: 100%;
          }

          .task-item:hover {
            background: var(--surface-2, #27272a);
            border-color: var(--surface-3, #3f3f46);
          }

          .task-item.selected {
            background: var(--surface-2, #27272a);
            border-color: var(--accent, #6366f1);
            outline: none;
          }

          .task-id {
            font-size: 11px;
            font-weight: 500;
            padding: 3px 0;
            border-radius: 4px;
            background: var(--surface-2, #27272a);
            color: var(--text-muted, #52525b);
            font-family: 'SF Mono', 'Consolas', monospace;
            flex-shrink: 0;
            width: 58px;
            text-align: center;
          }

          .task-title {
            flex: 1;
            font-size: 14px;
            color: var(--text-primary, #fafafa);
          }

          .task-badge {
            font-size: 11px;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 4px;
            text-transform: lowercase;
          }

          .task-badge.doing {
            background: var(--accent, #6366f1);
            color: #fff;
          }

          .task-badge.todo {
            background: var(--surface-2, #27272a);
            color: var(--text-secondary, #a1a1aa);
          }

          /* Tab bar */
          .tab-bar {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            padding: 4px;
            background: var(--surface-1, #18181b);
            border-radius: 8px;
          }

          .tab-btn {
            padding: 8px 16px;
            border: none;
            background: transparent;
            color: var(--text-muted, #52525b);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.2s ease;
          }

          .tab-btn.active {
            background: var(--accent, #6366f1);
            color: #fff;
          }

          .tab-btn:hover:not(.active) {
            color: var(--text-primary, #fafafa);
            background: var(--surface-2, #27272a);
          }

          /* Detail content */
          .detail-content {
            line-height: 1.6;
            color: var(--text-primary, #fafafa);
          }

          .detail-content > *:first-child {
            margin-top: 0;
          }

          .detail-content > *:last-child {
            margin-bottom: 0;
          }

          .detail-content h1,
          .detail-content h2,
          .detail-content h3 {
            margin: 1.5em 0 0.5em 0;
            font-weight: 600;
          }

          .detail-content h1 { font-size: 1.5em; }
          .detail-content h2 { font-size: 1.25em; }
          .detail-content h3 { font-size: 1.1em; }

          .detail-content p {
            margin: 0.75em 0;
          }

          .detail-content code {
            background: var(--surface-2, #27272a);
            padding: 0.15em 0.4em;
            border-radius: 4px;
            font-family: 'SF Mono', 'Consolas', monospace;
            font-size: 0.9em;
          }

          .detail-content pre {
            background: var(--surface-1, #18181b);
            border: 1px solid var(--surface-2, #27272a);
            border-radius: 8px;
            padding: 12px 16px;
            overflow-x: auto;
            margin: 1em 0;
          }

          .detail-content pre code {
            background: none;
            padding: 0;
            font-size: 0.85em;
            line-height: 1.5;
          }

          .detail-content ul,
          .detail-content ol {
            margin: 0.75em 0;
            padding-left: 1.5em;
          }

          .detail-content li {
            margin: 0.25em 0;
          }

          .detail-content a {
            color: var(--accent, #6366f1);
            text-decoration: none;
          }

          .detail-content a:hover {
            text-decoration: underline;
          }

          .detail-content blockquote {
            border-left: 3px solid var(--surface-3, #3f3f46);
            margin: 1em 0;
            padding-left: 1em;
            color: var(--text-secondary, #a1a1aa);
          }

          .detail-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
          }

          .detail-content th,
          .detail-content td {
            padding: 8px 12px;
            text-align: left;
            border: 1px solid var(--surface-2, #27272a);
          }

          .detail-content th {
            background: var(--surface-2, #27272a);
            font-weight: 600;
          }

          .detail-content hr {
            border: none;
            border-top: 1px solid var(--surface-2, #27272a);
            margin: 2em 0;
          }
        `}</style>
      </div>
    </Show>
  );
}
