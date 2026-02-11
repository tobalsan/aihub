import { For } from "solid-js";
import type { ConversationListItem } from "../../api/types";

type ConversationListProps = {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function formatDate(value?: string): string {
  if (!value) return "No date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export function ConversationList(props: ConversationListProps) {
  return (
    <div class="conversations-list" role="list">
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            class={`conversation-card ${props.selectedId === item.id ? "is-selected" : ""}`}
            onClick={() => props.onSelect(item.id)}
            role="listitem"
            aria-current={props.selectedId === item.id ? "true" : undefined}
          >
            <div class="conversation-card-top">
              <div class="conversation-title">{item.title}</div>
              <div class="conversation-date">{formatDate(item.date)}</div>
            </div>
            <div class="conversation-meta">
              <span class="conversation-source">{item.source ?? "unknown"}</span>
              <span>{item.participants.join(", ") || "no participants"}</span>
            </div>
            <div class="conversation-tags">
              <For each={item.tags.slice(0, 3)}>
                {(tag) => <span class="conversation-tag">#{tag}</span>}
              </For>
            </div>
          </button>
        )}
      </For>
    </div>
  );
}
