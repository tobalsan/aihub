import { createEffect, createSignal, For, Show } from "solid-js";
import type {
  FileBlock,
  FullHistoryMessage,
  FullToolResultMessage,
} from "../api/types";
import { formatFileSize } from "../lib/attachments";
import { extractBlockText, getTextBlocks } from "../lib/history";
import { renderMarkdown } from "../lib/markdown";

export type BoardLogItem =
  | {
      type: "text";
      role: "user" | "assistant";
      content: string;
      files?: FileBlock[];
    }
  | { type: "thinking"; content: string }
  | {
      type: "tool";
      id?: string;
      toolName: string;
      args: unknown;
      body?: string;
      result?: FullToolResultMessage;
      status?: "running" | "done" | "error";
    }
  | { type: "file"; content: string };

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function detailBody(
  toolName: string,
  args: Record<string, unknown>,
  body: string
) {
  const key = toolName.trim().toLowerCase();
  if (body.trim()) return body;
  if (key === "write" && typeof args.content === "string") return args.content;
  return formatJson(args);
}

function getToolResultText(result?: FullToolResultMessage): string {
  return (result?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => extractBlockText((block as { text: unknown }).text))
    .join("\n");
}

function getToolInputSummary(toolName: string, args: unknown): string {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    if (typeof record.command === "string") return record.command;
    if (typeof record.cmd === "string") return record.cmd;
    if (typeof record.path === "string") {
      return record.path.split("/").filter(Boolean).at(-1) ?? record.path;
    }
    if (typeof record.file_path === "string") {
      return (
        record.file_path.split("/").filter(Boolean).at(-1) ?? record.file_path
      );
    }
    if (typeof record.pattern === "string") return record.pattern;
    if (typeof record.query === "string") return record.query;
  }
  return toolName;
}

function truncateInline(value: string, max = 96): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max
    ? `${singleLine.slice(0, Math.max(0, max - 1))}…`
    : singleLine;
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
      const files = message.content.filter(
        (block): block is FileBlock => block.type === "file"
      );
      if (!content && files.length === 0) continue;
      items.push({
        type: "text",
        role: "user",
        content: content || "Attached file(s).",
        ...(files.length ? { files } : {}),
      });
      continue;
    }

    if (message.role === "toolResult") continue;

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        items.push({
          type: "thinking",
          content:
            typeof block.thinking === "string"
              ? block.thinking
              : String(block.thinking),
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

      items.push({
        type: "tool",
        id: block.id,
        toolName,
        args,
        body,
        result,
        status: result?.isError ? "error" : result ? "done" : "running",
      });
    }
  }

  return items;
}

function ToolLog(props: { item: Extract<BoardLogItem, { type: "tool" }> }) {
  const argsText = () => formatJson(props.item.args);
  const resultText = () =>
    getToolResultText(props.item.result) || props.item.body || "";
  const failed = () =>
    props.item.status === "error" || props.item.result?.isError;
  const statusLabel = () => {
    if (failed()) return "Failed";
    if (props.item.status === "running" || !props.item.result) return "Running";
    return "Ran";
  };
  const summary = () =>
    truncateInline(getToolInputSummary(props.item.toolName, props.item.args));
  const preview = () => truncateInline(resultText() || argsText(), 120);
  const [collapsed, setCollapsed] = createSignal(Boolean(resultText()));
  const [autoCollapsed, setAutoCollapsed] = createSignal(Boolean(resultText()));

  createEffect(() => {
    if (resultText() && !autoCollapsed()) {
      setCollapsed(true);
      setAutoCollapsed(true);
    }
  });

  return (
    <div class={`board-tool-block ${failed() ? "error" : ""}`}>
      <button
        class="board-tool-header"
        onClick={() => setCollapsed(!collapsed())}
      >
        <span class="board-collapse-icon">{collapsed() ? "▶" : "▼"}</span>
        <span class="board-tool-title">
          {statusLabel()} {summary()}
        </span>
        <span class="board-tool-kind">{props.item.toolName}</span>
        <Show when={collapsed()}>
          <span class="board-tool-preview">{preview()}</span>
        </Show>
      </button>
      <Show when={!collapsed()}>
        <div class="board-tool-body">
          <Show
            when={
              props.item.toolName === "bash" ||
              props.item.toolName === "exec_command"
            }
            fallback={
              <>
                <div class="board-tool-section-label">Input</div>
                <pre class="board-tool-code">{argsText()}</pre>
                <Show when={props.item.result || props.item.body}>
                  <div class="board-tool-section-label">Output</div>
                  <pre class="board-tool-code">
                    {resultText() || "(no output)"}
                  </pre>
                </Show>
              </>
            }
          >
            <div class="board-tool-section-label">Shell</div>
            <pre class="board-tool-code">
              {`$ ${getToolInputSummary(props.item.toolName, props.item.args)}${
                props.item.result || props.item.body
                  ? `\n\n${resultText() || "(no output)"}`
                  : ""
              }`}
            </pre>
          </Show>
          <Show when={props.item.result?.details?.diff}>
            <div class="board-tool-section-label">Diff</div>
            <pre class="board-tool-code">
              {props.item.result!.details!.diff}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
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

function DiffLog(props: { item: Extract<BoardLogItem, { type: "file" }> }) {
  return <pre class="board-log-pre">{props.item.content}</pre>;
}

function FileList(props: { files?: FileBlock[] }) {
  return (
    <Show when={props.files?.length}>
      <div class="board-msg-files">
        <For each={props.files}>
          {(file) => (
            <a
              class="board-msg-file"
              href={`/api/media/download/${file.fileId}`}
              target="_blank"
              rel="noreferrer"
            >
              <span class="board-msg-file-name">{file.filename}</span>
              <Show when={formatFileSize(file.size ?? 0)}>
                {(size) => <span class="board-msg-file-size">{size()}</span>}
              </Show>
            </a>
          )}
        </For>
      </div>
    </Show>
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
        fallback={
          <>
            <div class="board-msg-content">{props.item.content}</div>
            <FileList files={props.item.files} />
          </>
        }
      >
        <>
          <div
            class="board-msg-content board-msg-markdown"
            innerHTML={renderMarkdown(props.item.content)}
          />
          <FileList files={props.item.files} />
        </>
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
                    fallback={
                      <DiffLog
                        item={item as Extract<BoardLogItem, { type: "file" }>}
                      />
                    }
                  >
                    <ToolLog
                      item={item as Extract<BoardLogItem, { type: "tool" }>}
                    />
                  </Show>
                }
              >
                <ThinkingLog
                  item={item as Extract<BoardLogItem, { type: "thinking" }>}
                />
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

        .board-msg-files {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .board-msg-file {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: color-mix(in srgb, var(--text-primary) 5%, transparent);
          color: var(--text-secondary);
          font-size: 12px;
          text-decoration: none;
        }

        .board-msg-file:hover {
          color: var(--text-primary);
          border-color: color-mix(in srgb, var(--text-primary) 18%, var(--border-default));
        }

        .board-msg-file-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .board-msg-file-size {
          flex-shrink: 0;
          opacity: 0.7;
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
          display: none;
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

        .board-tool-block {
          background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-surface));
          border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent);
          border-radius: 14px;
          overflow: hidden;
        }

        .board-tool-block.error {
          border-color: color-mix(in srgb, #ef4444 42%, var(--border-default));
        }

        .board-tool-header {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 42px;
          padding: 8px 14px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          text-align: left;
        }

        .board-tool-header:hover {
          background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        }

        .board-collapse-icon {
          flex-shrink: 0;
          width: 10px;
          color: var(--text-secondary);
          font-size: 9px;
        }

        .board-tool-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 560;
        }

        .board-tool-kind {
          flex-shrink: 0;
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-primary) 6%, transparent);
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 11px;
        }

        .board-tool-preview {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 12px;
        }

        .board-tool-body {
          padding: 12px 14px 14px;
          border-top: 1px solid color-mix(in srgb, var(--border-default) 84%, transparent);
        }

        .board-tool-section-label {
          margin-bottom: 8px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 560;
        }

        .board-tool-section-label:not(:first-child) {
          margin-top: 14px;
        }

        .board-tool-code {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 12.5px;
          line-height: 1.62;
        }
      `}</style>
    </div>
  );
}
