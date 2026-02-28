import { For, Show, createSignal } from "solid-js";
import type { ProjectDetail } from "../../api/types";

type CenterTab = "chat" | "activity" | "changes";

type CenterPanelProps = {
  project: ProjectDetail;
  tab?: CenterTab;
  showTabs?: boolean;
  onAddComment?: (body: string) => Promise<void>;
};

export function CenterPanel(props: CenterPanelProps) {
  const [internalTab, setInternalTab] = createSignal<CenterTab>("chat");
  const [newComment, setNewComment] = createSignal("");
  const [addingComment, setAddingComment] = createSignal(false);
  const tab = () => props.tab ?? internalTab();
  const canSubmitComment = () =>
    Boolean(props.onAddComment) && newComment().trim().length > 0;

  const handleAddComment = async () => {
    if (!props.onAddComment || addingComment()) return;
    const body = newComment().trim();
    if (!body) return;
    setAddingComment(true);
    setNewComment("");
    try {
      await props.onAddComment(body);
    } finally {
      setAddingComment(false);
    }
  };

  const tabs: Array<{ id: CenterTab; label: string }> = [
    { id: "chat", label: "Chat" },
    { id: "activity", label: "Activity" },
    { id: "changes", label: "Changes" },
  ];

  return (
    <>
      <section class="center-panel">
        <Show when={props.showTabs !== false}>
          <header class="center-panel-tabs">
            <For each={tabs}>
              {(item) => (
                <button
                  type="button"
                  class="center-tab"
                  classList={{ active: tab() === item.id }}
                  onClick={() => setInternalTab(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </header>
        </Show>
        <div class="center-panel-body">
          <Show when={tab() === "chat"}>
            <p class="center-placeholder">Select an agent to chat</p>
          </Show>
          <Show when={tab() === "activity"}>
            <Show
              when={props.project.thread.length > 0}
              fallback={<p class="center-placeholder">No activity yet</p>}
            >
              <ul class="activity-list">
                <For each={props.project.thread}>
                  {(entry) => (
                    <li class="activity-item">
                      <div class="activity-meta">
                        <span class="activity-author">{entry.author}</span>
                        <span class="activity-date">{entry.date}</span>
                      </div>
                      <p>{entry.body}</p>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.onAddComment}>
              <div class="thread-add">
                <textarea
                  class="thread-add-textarea"
                  placeholder="Add a comment..."
                  value={newComment()}
                  onInput={(e) => setNewComment(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.metaKey || e.ctrlKey) &&
                      canSubmitComment()
                    ) {
                      e.preventDefault();
                      void handleAddComment();
                    }
                  }}
                  disabled={addingComment()}
                />
                <button
                  type="button"
                  class="thread-add-btn"
                  disabled={!canSubmitComment() || addingComment()}
                  onClick={() => void handleAddComment()}
                >
                  Add
                </button>
              </div>
            </Show>
          </Show>
          <Show when={tab() === "changes"}>
            <p class="center-placeholder">Git changes — coming soon</p>
          </Show>
        </div>
      </section>
      <style>{`
        .center-panel {
          min-height: 100%;
          display: grid;
          grid-template-rows: auto 1fr;
          background: #0a0a0f;
        }

        .center-panel-tabs {
          display: flex;
          gap: 8px;
          position: sticky;
          top: 0;
          z-index: 2;
          background: #0a0a0f;
          padding: 16px 18px;
          border-bottom: 1px solid #1c2430;
        }

        .center-tab {
          border: 1px solid #2a3240;
          background: #111722;
          color: #a1a1aa;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .center-tab.active {
          color: #e4e4e7;
          border-color: #3b82f6;
          background: #172554;
        }

        .center-panel-body {
          padding: 20px;
          color: #e4e4e7;
        }

        .center-placeholder {
          color: #71717a;
        }

        .activity-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
        }

        .activity-item {
          border: 1px solid #1f2937;
          border-radius: 10px;
          padding: 12px;
          background: #111722;
        }

        .activity-item p {
          margin: 8px 0 0;
          color: #d4d4d8;
          white-space: pre-wrap;
        }

        .activity-meta {
          display: grid;
          gap: 2px;
        }

        .activity-author {
          color: #9ca3af;
          font-weight: 600;
          line-height: 1.2;
        }

        .activity-date {
          color: #71717a;
          line-height: 1.2;
          font-size: 12px;
        }

        .thread-add {
          margin-top: 12px;
          display: grid;
          gap: 8px;
        }

        .thread-add-textarea {
          width: 100%;
          min-height: 82px;
          border-radius: 10px;
          border: 1px solid #1f2937;
          background: #0f172a;
          color: #e4e4e7;
          padding: 10px 12px;
          resize: vertical;
          font: inherit;
        }

        .thread-add-textarea:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .thread-add-btn {
          justify-self: end;
          border: 1px solid #3b82f6;
          background: #1d4ed8;
          color: #ffffff;
          border-radius: 8px;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 12px;
        }

        .thread-add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}
