import { For, Show } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { getConversationAttachmentUrl } from "../../api/client";
import type { ConversationDetail } from "../../api/types";

type ConversationThreadViewProps = {
  conversation: ConversationDetail;
};

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}

export function ConversationThreadView(props: ConversationThreadViewProps) {
  const shouldFallback = () =>
    props.conversation.messages.length === 0 && props.conversation.content.trim().length > 0;

  return (
    <article class="conversation-thread-view">
      <header class="thread-header">
        <h2>{props.conversation.title}</h2>
        <div class="detail-meta">
          <span>{props.conversation.date ?? "No date"}</span>
          <span>{props.conversation.source ?? "unknown"}</span>
        </div>
        <div class="detail-row">
          <strong>Participants:</strong>
          <span>{props.conversation.participants.join(", ") || "none"}</span>
        </div>
        <div class="detail-row">
          <strong>Tags:</strong>
          <span>{props.conversation.tags.map((value) => `#${value}`).join(" ") || "none"}</span>
        </div>
      </header>

      <section class="thread-section">
        <h3>Thread</h3>
        <Show when={!shouldFallback()} fallback={<pre class="thread-raw">{props.conversation.content}</pre>}>
          <Show
            when={props.conversation.messages.length > 0}
            fallback={<div class="empty">No messages parsed.</div>}
          >
            <div class="thread-messages">
              <For each={props.conversation.messages}>
                {(message) => (
                  <article class="thread-message">
                    <div class="thread-message-meta">
                      <strong>{message.speaker}</strong>
                      <Show when={message.timestamp}>
                        <span>{message.timestamp}</span>
                      </Show>
                    </div>
                    <div
                      class="thread-message-body markdown-content"
                      innerHTML={renderMarkdown(message.body)}
                    />
                  </article>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </section>

      <section class="thread-section">
        <h3>Attachments</h3>
        <Show
          when={props.conversation.attachments.length > 0}
          fallback={<div class="empty">No attachments.</div>}
        >
          <ul class="attachment-list">
            <For each={props.conversation.attachments}>
              {(name) => (
                <li>
                  <a href={getConversationAttachmentUrl(props.conversation.id, name)} target="_blank" rel="noreferrer">
                    {name}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </article>
  );
}
