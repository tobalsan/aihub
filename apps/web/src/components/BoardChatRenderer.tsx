import { For, Show } from "solid-js";
import type { FullHistoryMessage } from "../api/types";
import { getTextBlocks } from "../lib/history";
import { renderMarkdown } from "../lib/markdown";

export type BoardLogItem =
  | { type: "text"; role: "user" | "assistant"; content: string }
  | { type: "thinking"; content: string }
  | {
      type: "tool";
      toolName: string;
      title: string;
      body: string;
      icon: "read" | "write" | "bash" | "tool";
      expanded?: boolean;
    }
  | { type: "diff"; changes: number; content: string };

function countLines(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\r?\n/).length;
}

function countChanges(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => /^[+-](?![+-])/.test(line))
    .length;
}

function formatMeasure(value: number, unit: string): string {
  if (value <= 0) return `No ${unit}`;
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function summarizeToolLabel(
  toolName: string,
  args: Record<string, unknown> | null,
  body: string,
  diff?: string
): string {
  const key = toolName.trim().toLowerCase();
  if (key === "read") {
    const path =
      typeof args?.path === "string"
        ? args.path
        : typeof args?.file_path === "string"
          ? args.file_path
          : "file";
    return `Read ${path} · ${formatMeasure(countLines(body), "line")}`;
  }
  if (key === "exec_command" || key === "bash") {
    const command =
      typeof args?.cmd === "string"
        ? args.cmd
        : typeof args?.command === "string"
          ? args.command
          : toolName;
    const output = body.trim()
      ? formatMeasure(countLines(body), "line")
      : "No output";
    return `Bash ${command} · ${output}`;
  }
  if (key === "write") {
    const path =
      typeof args?.path === "string"
        ? args.path
        : typeof args?.file_path === "string"
          ? args.file_path
          : "file";
    return `Edit ${path} · ${formatMeasure(
      diff ? countChanges(diff) : countLines(body),
      "change"
    )}`;
  }
  return `${toolName || "Tool"} · ${
    diff
      ? formatMeasure(countChanges(diff), "change")
      : formatMeasure(countLines(body), "line")
  }`;
}

function toolIcon(toolName: string): BoardLogItem extends infer T
  ? T extends { type: "tool"; icon: infer I }
    ? I
    : never
  : never {
  const key = toolName.trim().toLowerCase();
  if (key === "read") return "read";
  if (key === "write") return "write";
  if (key === "bash" || key === "exec_command") return "bash";
  return "tool";
}

function detailBody(toolName: string, args: Record<string, unknown>, body: string) {
  const key = toolName.trim().toLowerCase();
  if (body.trim()) return body;
  if (key === "write" && typeof args.content === "string") return args.content;
  return formatJson(args);
}

export function buildBoardLogs(messages: FullHistoryMessage[]): BoardLogItem[] {
  const items: BoardLogItem[] = [];
  const toolResults = new Map<
    string,
    Extract<FullHistoryMessage, { role: "toolResult" }>
  >();

  for (const message of messages) {
    if (message.role === "toolResult") {
      toolResults.set(message.toolCallId, message);
    }
  }

  for (const message of messages) {
    if (message.role === "user") {
      const content = getTextBlocks(message.content);
      if (!content) continue;
      items.push({ type: "text", role: "user", content });
      continue;
    }

    if (message.role === "toolResult") continue;

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        items.push({
          type: "thinking",
          content:
            typeof block.thinking === "string" ? block.thinking : String(block.thinking),
        });
        continue;
      }

      if (block.type === "text") {
        const content = getTextBlocks([block]);
        if (!content) continue;
        items.push({ type: "text", role: "assistant", content });
        continue;
      }

      if (block.type !== "toolCall") continue;

      const toolName = block.name ?? "";
      const args =
        block.arguments && typeof block.arguments === "object"
          ? (block.arguments as Record<string, unknown>)
          : {};
      const result = toolResults.get(block.id);
      const output = result ? getTextBlocks(result.content) : "";
      const body = detailBody(toolName, args, output);
      const diff = result?.details?.diff;

      items.push({
        type: "tool",
        toolName,
        title: summarizeToolLabel(toolName, args, body, diff),
        body,
        icon: toolIcon(toolName),
      });

      if (diff) {
        items.push({
          type: "diff",
          changes: countChanges(diff),
          content: diff,
        });
      }
    }
  }

  return items;
}

function BoardLogIcon(props: { icon: "read" | "write" | "bash" | "tool" | "diff" }) {
  if (props.icon === "bash") {
    return (
      <svg
        class="board-log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 5h16v14H4z" />
        <path d="M7 9l3 3-3 3" />
        <path d="M12 15h4" />
      </svg>
    );
  }
  if (props.icon === "read") {
    return (
      <svg
        class="board-log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 19h12a4 4 0 0 0 0-8h-1" />
        <path d="M4 19V5h9a4 4 0 0 1 4 4v2" />
      </svg>
    );
  }
  if (props.icon === "write") {
    return (
      <svg
        class="board-log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5l4 4L8 20l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (props.icon === "diff") {
    return (
      <svg
        class="board-log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 3v18" />
        <path d="M5 8l7-5 7 5" />
        <path d="M19 16l-7 5-7-5" />
      </svg>
    );
  }
  return (
    <svg
      class="board-log-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3 3-3z" />
    </svg>
  );
}

function ToolLog(props: {
  item: Extract<BoardLogItem, { type: "tool" }>;
}) {
  return (
    <details class="board-log-details" open={props.item.expanded}>
      <summary class="board-log-summary">
        <BoardLogIcon icon={props.item.icon} />
        <span>{props.item.title}</span>
      </summary>
      <pre class="board-log-pre">{props.item.body || "No output"}</pre>
    </details>
  );
}

function ThinkingLog(props: {
  item: Extract<BoardLogItem, { type: "thinking" }>;
}) {
  return (
    <details class="board-log-details board-log-thinking">
      <summary class="board-log-summary">
        <span class="board-log-thinking-label">Thinking</span>
      </summary>
      <pre class="board-log-pre">{props.item.content}</pre>
    </details>
  );
}

function DiffLog(props: {
  item: Extract<BoardLogItem, { type: "diff" }>;
}) {
  return (
    <details class="board-log-details board-log-diff">
      <summary class="board-log-summary">
        <BoardLogIcon icon="diff" />
        <span>{`Diff · ${formatMeasure(props.item.changes, "change")}`}</span>
      </summary>
      <pre class="board-log-pre board-log-diff-pre">{props.item.content}</pre>
    </details>
  );
}

function TextLog(props: {
  item: Extract<BoardLogItem, { type: "text" }>;
  agentName: string;
}) {
  return (
    <div class={`board-msg board-msg-${props.item.role}`}>
      <div class="board-msg-role">
        <Show
          when={props.item.role === "assistant"}
          fallback={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </Show>
        <span>{props.item.role === "user" ? "You" : props.agentName}</span>
      </div>
      <Show
        when={props.item.role === "assistant"}
        fallback={<div class="board-msg-content">{props.item.content}</div>}
      >
        <div
          class="board-msg-content board-msg-markdown"
          innerHTML={renderMarkdown(props.item.content)}
        />
      </Show>
    </div>
  );
}

export function BoardChatLog(props: {
  items: BoardLogItem[];
  agentName: string;
}) {
  return (
    <div class="board-chat-log">
      <For each={props.items}>
        {(item) => (
          <Show
            when={item.type === "text"}
            fallback={
              <Show
                when={item.type === "thinking"}
                fallback={
                  <Show
                    when={item.type === "tool"}
                    fallback={<DiffLog item={item as Extract<BoardLogItem, { type: "diff" }>} />}
                  >
                    <ToolLog item={item as Extract<BoardLogItem, { type: "tool" }>} />
                  </Show>
                }
              >
                <ThinkingLog item={item as Extract<BoardLogItem, { type: "thinking" }>} />
              </Show>
            }
          >
            <TextLog
              item={item as Extract<BoardLogItem, { type: "text" }>}
              agentName={props.agentName}
            />
          </Show>
        )}
      </For>
      <style>{`
        .board-chat-log {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .board-msg {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .board-msg-role {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .board-msg-content {
          font-size: 14px;
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--text-primary);
        }

        .board-msg-user .board-msg-content {
          padding: 10px 14px;
          border-radius: 12px;
          border-top-right-radius: 4px;
          background: color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
          color: var(--text-primary);
        }

        .board-msg-assistant .board-msg-content {
          padding: 0;
          background: transparent;
        }

        .board-msg-markdown {
          white-space: normal;
          line-height: 1.55;
        }

        .board-msg-markdown > :first-child {
          margin-top: 0;
        }

        .board-msg-markdown > :last-child {
          margin-bottom: 0;
        }

        .board-msg-markdown p,
        .board-msg-markdown pre,
        .board-msg-markdown blockquote {
          margin: 0 0 0.5em;
        }

        .board-msg-markdown ul,
        .board-msg-markdown ol {
          margin: 0.25em 0;
          padding-left: 1.25em;
        }

        .board-msg-markdown li {
          margin: 0;
          padding: 0;
        }

        .board-msg-markdown li > p {
          margin: 0;
        }

        .board-msg-markdown li > ul,
        .board-msg-markdown li > ol {
          margin: 0;
        }

        .board-msg-markdown code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.92em;
        }

        .board-msg-markdown pre {
          overflow-x: auto;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
        }

        .board-log-details {
          border: 1px solid var(--border-default);
          border-radius: 14px;
          background: var(--bg-surface);
          overflow: hidden;
        }

        .board-log-summary {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          cursor: pointer;
          list-style: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
        }

        .board-log-summary::-webkit-details-marker {
          display: none;
        }

        .board-log-details[open] .board-log-summary {
          border-bottom: 1px solid var(--border-default);
        }

        .board-log-icon {
          width: 16px;
          height: 16px;
          flex: 0 0 auto;
          color: #6366f1;
        }

        .board-log-pre {
          margin: 0;
          padding: 14px;
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-primary);
          background: var(--bg-base);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .board-log-thinking .board-log-summary {
          font-style: italic;
        }

        .board-log-thinking-label {
          color: var(--text-secondary);
        }

        .board-log-diff {
          border-color: color-mix(in srgb, #6366f1 18%, var(--border-default));
        }

        .board-log-diff-pre {
          background:
            linear-gradient(
              180deg,
              color-mix(in srgb, #22c55e 8%, transparent) 0%,
              color-mix(in srgb, #ef4444 8%, transparent) 100%
            ),
            var(--bg-base);
        }
      `}</style>
    </div>
  );
}
