import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Show,
} from "solid-js";
import { fetchConversation, fetchConversations } from "../../api/client";
import type { ConversationFilters } from "../../api/types";
import { ConversationList } from "./ConversationList";
import { ConversationThreadView } from "./ConversationThreadView";

export function ConversationsPage() {
  const [q, setQ] = createSignal("");
  const [source, setSource] = createSignal("");
  const [tag, setTag] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const filters = createMemo<ConversationFilters>(() => ({
    q: q().trim() || undefined,
    source: source().trim() || undefined,
    tag: tag().trim() || undefined,
  }));

  const [items] = createResource(filters, fetchConversations);
  const [detail] = createResource(selectedId, async (id) => {
    if (!id) return null;
    return fetchConversation(id);
  });

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

  return (
    <div class="conversations-page">
      <header class="conversations-header">
        <h1>Conversations</h1>
        <a class="back-link" href="/projects">
          Back to projects
        </a>
      </header>

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
          <Show when={!items.loading} fallback={<div class="empty">Loading...</div>}>
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
          <Show when={selectedConversation()} fallback={<div class="empty">Select a conversation.</div>}>
            <Show when={!detail.loading} fallback={<div class="empty">Loading thread...</div>}>
              <Show when={detail()} fallback={<div class="empty">Failed to load conversation thread.</div>}>
                {(conversation) => <ConversationThreadView conversation={conversation()} />}
              </Show>
            </Show>
          </Show>
        </section>
      </div>

      <style>{`
        .conversations-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          color: #d7dce3;
          background: #0d1117;
        }

        .conversations-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid #1f2835;
        }

        .conversations-header h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .back-link {
          border: 1px solid #2b3340;
          border-radius: 999px;
          color: #aeb8c7;
          padding: 6px 12px;
          text-decoration: none;
          font-size: 12px;
        }

        .back-link:hover {
          color: #d7dce3;
          border-color: #3b4657;
        }

        .conversation-filters {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid #1f2835;
        }

        .conversation-filters input {
          border: 1px solid #273244;
          background: #111827;
          color: #d7dce3;
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
        }

        .conversations-list-pane {
          border-bottom: 1px solid #1f2835;
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
          color: #9ba8bb;
          font-size: 12px;
        }

        .detail-row {
          display: flex;
          gap: 8px;
          margin-top: 6px;
          color: #b3bfce;
          font-size: 13px;
        }

        .thread-section h3 {
          margin: 0 0 10px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9db3d6;
        }

        .thread-messages {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .thread-message {
          border: 1px solid #1f2835;
          border-radius: 10px;
          background: #101722;
          padding: 10px;
        }

        .thread-message-meta {
          display: flex;
          align-items: baseline;
          gap: 10px;
          font-size: 12px;
          color: #9ba8bb;
          margin-bottom: 8px;
        }

        .thread-message-body {
          color: #d7dce3;
        }

        .thread-raw {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid #273244;
          background: #0f1725;
          border-radius: 10px;
          padding: 10px;
          color: #d7dce3;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
        }

        .attachment-list {
          margin: 0;
          padding-left: 20px;
          color: #d7dce3;
        }

        .attachment-list a {
          color: #8fb2ff;
          text-decoration: none;
        }

        .attachment-list a:hover {
          text-decoration: underline;
        }

        .markdown-content p {
          margin: 0;
        }

        .markdown-content p + p {
          margin-top: 8px;
        }

        .conversations-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
        }

        .conversation-card {
          border: 1px solid #1f2835;
          border-radius: 10px;
          background: #101722;
          text-align: left;
          padding: 10px;
          color: #d7dce3;
          cursor: pointer;
        }

        .conversation-card.is-selected {
          border-color: #4166aa;
          background: #121f32;
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
          color: #8b98aa;
          font-size: 12px;
          white-space: nowrap;
        }

        .conversation-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 6px;
          color: #9ba8bb;
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
          color: #a8b4c6;
          font-size: 13px;
          line-height: 1.35;
        }

        .conversation-detail {
          display: flex;
          flex-direction: column;
          gap: 10px;
          border: 1px solid #1f2835;
          border-radius: 12px;
          padding: 14px;
          background: #101722;
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
          color: #8c99ab;
          font-size: 12px;
        }

        .detail-row {
          display: flex;
          gap: 8px;
          font-size: 13px;
          color: #bcc6d5;
        }

        .detail-row strong {
          color: #d7dce3;
        }

        .empty {
          padding: 20px;
          color: #8c99ab;
          font-size: 13px;
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
            border-right: 1px solid #1f2835;
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
