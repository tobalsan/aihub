import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Show,
} from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import {
  fetchConversation,
  fetchConversations,
  postConversationMessage,
} from "../../api/client";
import type { ConversationFilters } from "../../api/types";
import { ConversationList } from "./ConversationList";
import { ConversationThreadView } from "./ConversationThreadView";
import { CreateProjectFromConversationModal } from "./CreateProjectFromConversationModal";
import { ThreadReplyInput } from "./ThreadReplyInput";

export function ConversationsPage() {
  const navigate = useNavigate();
  const [q, setQ] = createSignal("");
  const [source, setSource] = createSignal("");
  const [tag, setTag] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = createSignal(false);
  const [toast, setToast] = createSignal<string | null>(null);
  const [replyStatus, setReplyStatus] = createSignal<
    "idle" | "submitting" | "mentions"
  >("idle");
  const [replyError, setReplyError] = createSignal<string | null>(null);

  const filters = createMemo<ConversationFilters>(() => ({
    q: q().trim() || undefined,
    source: source().trim() || undefined,
    tag: tag().trim() || undefined,
  }));

  const [items] = createResource(filters, fetchConversations);
  const [detail, { refetch: refetchDetail }] = createResource(
    selectedId,
    async (id) => {
      if (!id) return null;
      return fetchConversation(id);
    }
  );

  const selectedConversation = createMemo(() => {
    const list = items() ?? [];
    const selected = selectedId();
    if (!selected) return list[0] ?? null;
    return list.find((item) => item.id === selected) ?? list[0] ?? null;
  });

  createEffect(() => {
    const selected = selectedConversation();
    setSelectedId(selected?.id ?? null);
  });

  const onProjectCreated = (projectId: string) => {
    setToast(`Project ${projectId} created`);
    window.setTimeout(() => {
      navigate(`/projects/${projectId}`);
    }, 450);
  };

  const submitReply = async (message: string): Promise<boolean> => {
    const selected = selectedConversation();
    if (!selected) return false;
    setReplyError(null);
    setReplyStatus("submitting");
    try {
      const response = await postConversationMessage(selected.id, { message });
      if ((response.mentions?.length ?? 0) > 0) {
        setReplyStatus("mentions");
      }
      await refetchDetail();
      setReplyStatus("idle");
      return true;
    } catch (error) {
      setReplyStatus("idle");
      setReplyError(
        error instanceof Error
          ? error.message
          : "Failed to post conversation reply"
      );
      return false;
    }
  };

  return (
    <div class="conversations-page">
      <header class="conversations-header">
        <h1>Conversations</h1>
        <div class="header-actions">
          <button
            class="create-link"
            type="button"
            onClick={() => setCreateModalOpen(true)}
            disabled={!detail() || detail.loading}
          >
            Create project
          </button>
          <A class="back-link" href="/projects">
            Back to projects
          </A>
        </div>
      </header>

      <Show when={toast()}>
        {(message) => <div class="conversations-toast">{message()}</div>}
      </Show>

      <div class="conversation-filters">
        <input
          type="search"
          placeholder="Search text"
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
        <input
          type="text"
          placeholder="Source"
          value={source()}
          onInput={(e) => setSource(e.currentTarget.value)}
        />
        <input
          type="text"
          placeholder="Tag"
          value={tag()}
          onInput={(e) => setTag(e.currentTarget.value)}
        />
      </div>

      <div class="conversations-layout">
        <section class="conversations-pane conversations-list-pane">
          <Show
            when={!items.loading}
            fallback={<div class="empty">Loading...</div>}
          >
            <Show
              when={(items() ?? []).length > 0}
              fallback={<div class="empty">No conversations found.</div>}
            >
              <ConversationList
                items={items() ?? []}
                selectedId={selectedId()}
                onSelect={setSelectedId}
              />
            </Show>
          </Show>
        </section>

        <section class="conversations-pane conversations-detail-pane">
          <Show
            when={selectedConversation()}
            fallback={<div class="empty">Select a conversation.</div>}
          >
            <Show
              when={!detail.loading}
              fallback={<div class="empty">Loading thread...</div>}
            >
              <Show
                when={detail()}
                fallback={
                  <div class="empty">Failed to load conversation thread.</div>
                }
              >
                {(conversation) => (
                  <>
                    <ConversationThreadView conversation={conversation()} />
                    <ThreadReplyInput
                      disabled={detail.loading || !selectedConversation()}
                      status={replyStatus()}
                      error={replyError()}
                      onSubmit={submitReply}
                    />
                  </>
                )}
              </Show>
            </Show>
          </Show>
        </section>
      </div>

      <CreateProjectFromConversationModal
        open={createModalOpen()}
        conversation={detail() ?? null}
        onClose={() => setCreateModalOpen(false)}
        onCreated={onProjectCreated}
      />

      <style>{`
        .conversations-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          color: var(--text-primary);
          background: var(--bg-base);
        }

        .conversations-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .conversations-header h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .create-link {
          border: 1px solid #2d4264;
          border-radius: 999px;
          color: #c2d6ff;
          background: #13233c;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .create-link:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .back-link {
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--text-secondary);
          padding: 6px 12px;
          text-decoration: none;
          font-size: 12px;
        }

        .back-link:hover {
          color: var(--text-primary);
          border-color: #3b4657;
        }

        .conversations-toast {
          margin: 10px 16px 0;
          border: 1px solid #2c4f7c;
          background: #12243a;
          color: #c5dbff;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .conversation-filters {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .conversation-filters input {
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          color: var(--text-primary);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          outline: none;
        }

        .conversation-filters input:focus {
          border-color: #4166aa;
        }

        .conversations-layout {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        .conversations-pane {
          min-height: 0;
          overflow: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
        }

        .conversations-list-pane {
          border-bottom: 1px solid var(--border-subtle);
        }

        .conversations-detail-pane {
          padding: 12px;
        }

        .conversation-thread-view {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .thread-header h2 {
          margin: 0;
          font-size: 18px;
        }

        .detail-meta {
          display: flex;
          gap: 10px;
          margin-top: 6px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .detail-row {
          display: flex;
          gap: 8px;
          margin-top: 6px;
          color: var(--text-primary);
          font-size: 13px;
        }

        .thread-section h3 {
          margin: 0 0 10px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9db3d6;
        }

        .thread-reply {
          margin-top: 14px;
          border-top: 1px solid var(--border-subtle);
          padding-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .thread-reply h3 {
          margin: 0;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9db3d6;
        }

        .thread-reply-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .thread-reply-textarea {
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          color: var(--text-primary);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          line-height: 1.35;
          resize: vertical;
          min-height: 84px;
          outline: none;
        }

        .thread-reply-textarea:focus {
          border-color: #4166aa;
        }

        .thread-reply-textarea:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .thread-reply-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .thread-reply-btn {
          border: 1px solid #305285;
          background: #1a3253;
          color: #d2e5ff;
          border-radius: 10px;
          padding: 7px 10px;
          font-size: 12px;
          cursor: pointer;
        }

        .thread-reply-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .thread-reply-thinking {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #9db3d6;
          font-size: 12px;
        }

        .thread-thinking-dots {
          display: inline-flex;
          gap: 4px;
        }

        .thread-thinking-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #9db3d6;
          opacity: 0.35;
          animation: thread-thinking 1.4s ease-in-out infinite;
        }

        .thread-thinking-dots span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .thread-thinking-dots span:nth-child(3) {
          animation-delay: 0.3s;
        }

        .thread-reply-error {
          border: 1px solid #743b44;
          border-radius: 10px;
          background: #2a1519;
          color: #ffb4bf;
          padding: 8px 10px;
          font-size: 12px;
        }

        .thread-messages {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .thread-message {
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 16px 14px;
        }

        .thread-message:nth-child(odd) {
          background: var(--bg-base);
        }

        .thread-message:nth-child(even) {
          background: var(--bg-surface);
        }

        .thread-message-meta {
          display: flex;
          align-items: baseline;
          gap: 10px;
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }

        .thread-message-body {
          color: var(--text-primary);
        }

        .thread-raw {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid var(--border-subtle);
          background: var(--bg-inset);
          border-radius: 10px;
          padding: 10px;
          color: var(--text-primary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
        }

        .attachment-list {
          margin: 0;
          padding-left: 20px;
          color: var(--text-primary);
        }

        .attachment-list a {
          color: #8fb2ff;
          text-decoration: none;
        }

        .attachment-list a:hover {
          text-decoration: underline;
        }

        .markdown-content {
          font-size: 14px;
          line-height: 1.7;
        }

        .markdown-content > *:first-child {
          margin-top: 0;
        }

        .markdown-content > *:last-child {
          margin-bottom: 0;
        }

        .markdown-content p {
          margin: 0.4em 0;
        }

        .markdown-content a {
          color: #8fb2ff;
          text-decoration: underline;
          text-decoration-color: rgba(143, 178, 255, 0.35);
          text-underline-offset: 2px;
          transition: text-decoration-color 0.15s ease;
        }

        .markdown-content a:hover {
          text-decoration-color: #8fb2ff;
        }

        .markdown-content ul,
        .markdown-content ol {
          margin: 0.5em 0;
          padding-left: 1.6em;
        }

        .markdown-content li {
          margin: 0.3em 0;
        }

        .markdown-content li p {
          margin: 0;
        }

        .markdown-content code {
          background: #1a2233;
          padding: 0.15em 0.4em;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
        }

        .markdown-content pre {
          background: var(--bg-inset);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 10px;
          overflow-x: auto;
          margin: 0.5em 0;
        }

        .markdown-content pre code {
          background: none;
          padding: 0;
          font-size: 0.85em;
          line-height: 1.5;
        }

        .markdown-content blockquote {
          border-left: 3px solid #2d4264;
          margin: 0.4em 0;
          padding-left: 0.75em;
          color: var(--text-secondary);
        }

        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin: 0.6em 0 0.3em;
          font-weight: 600;
        }

        .markdown-content strong {
          color: var(--text-primary);
        }

        .conversations-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
        }

        .conversation-card {
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          background: var(--bg-overlay);
          text-align: left;
          padding: 10px;
          color: var(--text-primary);
          cursor: pointer;
        }

        .conversation-card.is-selected {
          border-color: #4166aa;
          background: var(--bg-input);
        }

        .conversation-card-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }

        .conversation-title {
          font-weight: 600;
          font-size: 14px;
        }

        .conversation-date {
          color: var(--text-secondary);
          font-size: 12px;
          white-space: nowrap;
        }

        .conversation-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 6px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .conversation-source {
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .conversation-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }

        .conversation-tag {
          font-size: 11px;
          color: #9db3d6;
          background: #0d1b2e;
          border: 1px solid #294164;
          border-radius: 999px;
          padding: 2px 8px;
        }

        .conversation-preview {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.35;
        }

        .conversation-detail {
          display: flex;
          flex-direction: column;
          gap: 10px;
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 14px;
          background: var(--bg-overlay);
        }

        .conversation-detail h2 {
          margin: 0;
          font-size: 16px;
          line-height: 1.3;
        }

        .detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .detail-row {
          display: flex;
          gap: 8px;
          font-size: 13px;
          color: var(--text-primary);
        }

        .detail-row strong {
          color: var(--text-primary);
        }

        .empty {
          padding: 20px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        @keyframes thread-thinking {
          0%, 80%, 100% {
            transform: scale(0.85);
            opacity: 0.35;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .overlay {
          position: fixed;
          inset: 0;
          z-index: 1200;
          display: grid;
          place-items: center;
        }

        .overlay-backdrop {
          position: absolute;
          inset: 0;
          background: var(--shadow-md);
        }

        .conversation-create-modal {
          position: relative;
          width: min(420px, calc(100vw - 32px));
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .conversation-create-modal h3 {
          margin: 0;
          font-size: 15px;
        }

        .conversation-create-modal label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .conversation-create-modal input {
          border: 1px solid var(--border-subtle);
          background: var(--bg-inset);
          color: var(--text-primary);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          outline: none;
        }

        .modal-hint {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .modal-error {
          border: 1px solid #743b44;
          border-radius: 10px;
          background: #2a1519;
          color: #ffb4bf;
          padding: 8px 10px;
          font-size: 12px;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .modal-actions button {
          border-radius: 10px;
          padding: 7px 10px;
          font-size: 12px;
          cursor: pointer;
          border: 1px solid var(--border-subtle);
          background: var(--bg-input);
          color: var(--text-primary);
        }

        .modal-actions .primary {
          border-color: #305285;
          background: #1a3253;
          color: #d2e5ff;
        }

        .modal-actions button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        @media (min-width: 900px) {
          .conversation-filters {
            grid-template-columns: minmax(220px, 1fr) 180px 180px;
          }

          .conversations-layout {
            flex-direction: row;
          }

          .conversations-list-pane {
            width: 380px;
            border-right: 1px solid var(--border-subtle);
            border-bottom: none;
          }

          .conversations-detail-pane {
            flex: 1;
            min-width: 0;
            padding: 16px;
          }
        }
      `}</style>
    </div>
  );
}
