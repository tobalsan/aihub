import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { renderMarkdown } from "../../lib/markdown";
import { extractBlockText } from "../../lib/history";
import { formatFileSize } from "../../lib/attachments";
import type { FileBlock, FullToolResultMessage } from "../../api/types";
import { LeftNavShell } from "../../components/LeftNavShell";
import {
  fetchOrchestratorHealth,
  fetchOrchestratorLogs,
  fetchOrchestratorRun,
  fetchOrchestratorRuns,
  fetchOrchestratorWorkflow,
  interruptOrchestratorRun,
  killOrchestratorRun,
  type OrchestratorClaim,
  type OrchestratorEvent,
  type OrchestratorHealth,
  type OrchestratorLogEvent,
  type OrchestratorRun,
  type OrchestratorWorkflow,
} from "../../api/orchestrator";
import { subscribeToRealtime } from "../../api/realtime-client";

type AnyRun = OrchestratorRun | OrchestratorClaim;

function runIssueId(run: AnyRun): string {
  return String(run.issueId ?? run.issue_id ?? run.identifier ?? "");
}

function runId(run: AnyRun): string {
  return String(run.runId ?? run.run_id ?? run.issueId ?? run.issue_id ?? "");
}

function displayId(run: AnyRun): string {
  const ident = run.identifier;
  if (typeof ident === "string" && ident) return ident;
  const issue = runIssueId(run);
  return issue || runId(run) || "run";
}

function projectFromRun(run?: AnyRun): string | undefined {
  const value = run?.projectId ?? run?.project_id;
  return typeof value === "string" ? value : undefined;
}

// Composite run ids look like
// "orchestrator:project-name:07184c8c-783b-40c0-...:1780409346460".
// Collapse to a glanceable short hash; full string is copyable.
function shortRunId(value: string): string {
  if (!value) return "";
  if (value.length <= 22) return value;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function absTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function relTime(value: unknown, now: number): string {
  if (typeof value !== "string" || !value) return "—";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return value;
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

type Tone = "live" | "ok" | "fail" | "warn" | "muted";

function outcomeTone(run: OrchestratorRun): Tone {
  const finished = run.finished_at || run.finishedAt;
  const outcome = (run.outcome ?? "").toLowerCase();
  if (!finished && !outcome) return "live";
  if (/fail|error/.test(outcome)) return "fail";
  if (/interrupt|cancel|orphan/.test(outcome)) return "warn";
  if (/needs_human|stall|human/.test(outcome)) return "warn";
  if (/complete|success|done|finish/.test(outcome)) return "ok";
  return "muted";
}

function outcomeLabel(run: OrchestratorRun): string {
  const finished = run.finished_at || run.finishedAt;
  const outcome = (run.outcome ?? "").toLowerCase();
  if (!outcome) return finished ? "finished" : "running";
  if (/interrupt|gateway_restart/.test(outcome)) return "interrupted";
  if (/orphan/.test(outcome)) return "orphaned";
  if (/needs_human|human/.test(outcome)) return "needs human";
  if (/dispatch_fail/.test(outcome)) return "dispatch failed";
  if (/fail|error/.test(outcome)) return "failed";
  return outcome.replace(/_/g, " ");
}

const TONE_GLYPH: Record<Tone, string> = {
  live: "●",
  ok: "✓",
  fail: "✕",
  warn: "⏸",
  muted: "•",
};

function StatusPill(props: { tone: Tone; label: string; title?: string }): JSX.Element {
  return (
    <span class="orch-pill" data-tone={props.tone} title={props.title ?? props.label}>
      <span class="orch-pill-glyph" classList={{ "orch-pulse": props.tone === "live" }}>
        {TONE_GLYPH[props.tone]}
      </span>
      <span class="orch-pill-text">{props.label}</span>
    </span>
  );
}

function eventPayload(event: OrchestratorEvent): string {
  if (typeof event.payload !== "string") return JSON.stringify(event, null, 2);
  try {
    return JSON.stringify(JSON.parse(event.payload), null, 2);
  } catch {
    return event.payload;
  }
}

// ── Agent-run transcript rendering ──────────────────────────────────────────
// Mirrors the project details Agents tab transcript renderer.
// Copied (not imported) so the orchestrator extension stays self-contained.

type AgentTranscriptItem =
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

function logParseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringifyToolArgs(text: string) {
  const parsed = logParseJsonRecord(text);
  return parsed ?? { input: text };
}

function eventToTranscriptItem(event: OrchestratorLogEvent): AgentTranscriptItem | null {
  const tool = getRecord(event.tool);
  const diff = getRecord(event.diff);
  const text = (
    (typeof event.text === "string" ? event.text : "") ||
    (typeof diff?.summary === "string" ? diff.summary : "") ||
    (typeof tool?.name === "string" ? tool.name : "")
  ).trim();
  if (!text) return null;

  if (event.type === "stderr" || event.type === "error") {
    return { type: "text", role: "assistant", content: text };
  }
  if (event.type === "tool_call" || event.type === "tool_output") {
    return {
      type: "tool",
      id: typeof tool?.id === "string" ? tool.id : undefined,
      toolName: typeof tool?.name === "string" ? tool.name : "tool",
      args: stringifyToolArgs(text),
      body: event.type === "tool_output" ? text : undefined,
      status: event.type === "tool_output" ? "done" : "running",
    };
  }
  if (event.type === "user") return { type: "text", role: "user", content: text };
  if (event.type === "assistant") {
    return { type: "text", role: "assistant", content: text };
  }

  const parsed = logParseJsonRecord(text);
  if (!parsed) {
    return event.type === "stdout"
      ? { type: "text", role: "assistant", content: text }
      : null;
  }

  const payload = getRecord(parsed.payload);
  if (parsed.type === "event_msg" && payload?.type === "user_message") {
    const message = typeof payload.message === "string" ? payload.message : "";
    return message ? { type: "text", role: "user", content: message } : null;
  }
  if (parsed.type === "event_msg" && payload?.type === "agent_message") {
    const message = typeof payload.message === "string" ? payload.message : "";
    return message
      ? { type: "text", role: "assistant", content: message }
      : null;
  }

  const item = getRecord(parsed.item);
  if (item?.type === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const output =
      typeof item.aggregated_output === "string"
        ? item.aggregated_output.trim()
        : "";
    const status = typeof item.status === "string" ? item.status : "";
    const exitCode =
      typeof item.exit_code === "number" ? item.exit_code : undefined;
    return {
      type: "tool",
      toolName: "exec_command",
      args: { command },
      body: output,
      status:
        status === "completed" && exitCode !== undefined && exitCode !== 0
          ? "error"
          : status === "in_progress"
            ? "running"
            : "done",
    };
  }

  return null;
}

function transcriptItems(events: OrchestratorLogEvent[]): AgentTranscriptItem[] {
  return events
    .map(eventToTranscriptItem)
    .filter((item): item is AgentTranscriptItem => item !== null);
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

function ToolLog(props: { item: Extract<AgentTranscriptItem, { type: "tool" }> }) {
  const argsText = () => formatJson(props.item.args);
  const resultText = () =>
    getToolResultText(props.item.result) || props.item.body || "";
  const failed = () =>
    props.item.status === "error" || props.item.result?.isError;
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
    <div class={`orch-tool-block ${failed() ? "error" : ""}`}>
      <button
        class="orch-tool-header"
        onClick={() => setCollapsed(!collapsed())}
      >
        <span class="orch-collapse-icon">{collapsed() ? "▶" : "▼"}</span>
        <span class="orch-tool-kind">{props.item.toolName}</span>
        <span class="orch-tool-title">{summary()}</span>
        <Show when={collapsed()}>
          <span class="orch-tool-preview">{preview()}</span>
        </Show>
      </button>
      <Show when={!collapsed()}>
        <div class="orch-tool-body">
          <Show
            when={
              props.item.toolName === "bash" ||
              props.item.toolName === "exec_command"
            }
            fallback={
              <>
                <div class="orch-tool-section-label">Input</div>
                <pre class="orch-tool-code">{argsText()}</pre>
                <Show when={props.item.result || props.item.body}>
                  <div class="orch-tool-section-label">Output</div>
                  <pre class="orch-tool-code">
                    {resultText() || "(no output)"}
                  </pre>
                </Show>
              </>
            }
          >
            <div class="orch-tool-section-label">Shell</div>
            <pre class="orch-tool-code">
              {`$ ${getToolInputSummary(props.item.toolName, props.item.args)}${
                props.item.result || props.item.body
                  ? `\n\n${resultText() || "(no output)"}`
                  : ""
              }`}
            </pre>
          </Show>
          <Show when={props.item.result?.details?.diff}>
            <div class="orch-tool-section-label">Diff</div>
            <pre class="orch-tool-code">
              {props.item.result!.details!.diff}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ThinkingLog(props: {
  item: Extract<AgentTranscriptItem, { type: "thinking" }>;
}) {
  return (
    <details class="orch-log-details orch-log-thinking">
      <summary class="orch-log-summary">
        <span class="orch-log-thinking-label">Thinking</span>
      </summary>
      <pre class="orch-log-pre">{props.item.content}</pre>
    </details>
  );
}

function DiffLog(props: { item: Extract<AgentTranscriptItem, { type: "file" }> }) {
  return <pre class="orch-log-pre">{props.item.content}</pre>;
}

function FileList(props: { files?: FileBlock[] }) {
  return (
    <Show when={props.files?.length}>
      <div class="orch-msg-files">
        <For each={props.files}>
          {(file) => (
            <a
              class="orch-msg-file"
              href={`/api/media/download/${file.fileId}`}
              target="_blank"
              rel="noreferrer"
            >
              <span class="orch-msg-file-name">{file.filename}</span>
              <Show when={formatFileSize(file.size ?? 0)}>
                {(size) => <span class="orch-msg-file-size">{size()}</span>}
              </Show>
            </a>
          )}
        </For>
      </div>
    </Show>
  );
}

function TextLog(props: {
  item: Extract<AgentTranscriptItem, { type: "text" }>;
  agentName: string;
}) {
  return (
    <div class={`orch-msg orch-msg-${props.item.role}`}>
      <div class="orch-msg-role">
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
        <span>{props.item.role === "user" ? "Prompt" : props.agentName}</span>
      </div>
      <Show
        when={props.item.role === "assistant"}
        fallback={
          <>
            <div class="orch-msg-content">{props.item.content}</div>
            <FileList files={props.item.files} />
          </>
        }
      >
        <>
          <div
            class="orch-msg-content orch-msg-markdown"
            innerHTML={renderMarkdown(props.item.content)}
          />
          <FileList files={props.item.files} />
        </>
      </Show>
    </div>
  );
}

function AgentTranscriptLog(props: { items: AgentTranscriptItem[]; agentName: string }) {
  return (
    <div class="orch-transcript-log">
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
                        item={item as Extract<AgentTranscriptItem, { type: "file" }>}
                      />
                    }
                  >
                    <ToolLog
                      item={item as Extract<AgentTranscriptItem, { type: "tool" }>}
                    />
                  </Show>
                }
              >
                <ThinkingLog
                  item={item as Extract<AgentTranscriptItem, { type: "thinking" }>}
                />
              </Show>
            }
          >
            <TextLog
              item={item as Extract<AgentTranscriptItem, { type: "text" }>}
              agentName={props.agentName}
            />
          </Show>
        )}
      </For>
      <style>{`
        .orch-transcript-log {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .orch-msg {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .orch-msg-role {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .orch-msg-content {
          font-size: 14px;
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--text-primary);
        }

        .orch-msg-user .orch-msg-content {
          padding: 10px 14px;
          border-radius: 12px;
          border-top-right-radius: 4px;
          background: color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
          color: var(--text-primary);
        }

        .orch-msg-assistant .orch-msg-content {
          padding: 0;
          background: transparent;
        }

        .orch-msg-files {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .orch-msg-file {
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

        .orch-msg-file:hover {
          color: var(--text-primary);
          border-color: color-mix(in srgb, var(--text-primary) 18%, var(--border-default));
        }

        .orch-msg-file-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .orch-msg-file-size {
          flex-shrink: 0;
          opacity: 0.7;
        }

        .orch-msg-markdown {
          white-space: normal;
          line-height: 1.55;
        }

        .orch-msg-markdown > :first-child {
          margin-top: 0;
        }

        .orch-msg-markdown > :last-child {
          margin-bottom: 0;
        }

        .orch-msg-markdown p,
        .orch-msg-markdown pre,
        .orch-msg-markdown blockquote {
          margin: 0 0 0.5em;
        }

        .orch-msg-markdown ul,
        .orch-msg-markdown ol {
          margin: 0.25em 0;
          padding-left: 1.25em;
        }

        .orch-msg-markdown li {
          margin: 0;
          padding: 0;
        }

        .orch-msg-markdown li > p {
          margin: 0;
        }

        .orch-msg-markdown li > ul,
        .orch-msg-markdown li > ol {
          margin: 0;
        }

        .orch-msg-markdown code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.92em;
        }

        .orch-msg-markdown pre {
          overflow-x: auto;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
        }

        .orch-log-details {
          border: 1px solid var(--border-default);
          border-radius: 14px;
          background: var(--bg-surface);
          overflow: hidden;
        }

        .orch-log-summary {
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

        .orch-log-summary::-webkit-details-marker {
          display: none;
        }

        .orch-log-details[open] .orch-log-summary {
          border-bottom: 1px solid var(--border-default);
        }

        .orch-log-icon {
          display: none;
        }

        .orch-log-pre {
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

        .orch-log-thinking .orch-log-summary {
          font-style: italic;
        }

        .orch-log-thinking-label {
          color: var(--text-secondary);
        }

        .orch-tool-block {
          background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-surface));
          border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent);
          border-radius: 14px;
          overflow: hidden;
        }

        .orch-tool-block.error {
          border-color: color-mix(in srgb, #ef4444 42%, var(--border-default));
        }

        .orch-tool-header {
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

        .orch-tool-header:hover {
          background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        }

        .orch-collapse-icon {
          flex-shrink: 0;
          width: 10px;
          color: var(--text-secondary);
          font-size: 9px;
        }

        .orch-tool-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 560;
        }

        .orch-tool-kind {
          flex-shrink: 0;
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-primary) 6%, transparent);
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 11px;
        }

        .orch-tool-preview {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 12px;
        }

        .orch-tool-body {
          padding: 12px 14px 14px;
          border-top: 1px solid color-mix(in srgb, var(--border-default) 84%, transparent);
        }

        .orch-tool-section-label {
          margin-bottom: 8px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 560;
        }

        .orch-tool-section-label:not(:first-child) {
          margin-top: 14px;
        }

        .orch-tool-code {
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

function OrchestratorDashboard(): ReturnType<Component> {
  const [health, setHealth] = createSignal<OrchestratorHealth>();
  const [active, setActive] = createSignal<OrchestratorClaim[]>([]);
  const [recent, setRecent] = createSignal<OrchestratorRun[]>([]);
  const [selected, setSelected] = createSignal<AnyRun>();
  const [workflow, setWorkflow] = createSignal<OrchestratorWorkflow>();
  const [events, setEvents] = createSignal<OrchestratorEvent[]>([]);
  const [logs, setLogs] = createSignal<OrchestratorLogEvent[]>([]);
  const [logCursor, setLogCursor] = createSignal(0);
  const [tab, setTab] = createSignal<"logs" | "events" | "workflow">("logs");
  const [error, setError] = createSignal<string>();
  const [copied, setCopied] = createSignal<string>();
  const [now, setNow] = createSignal(Date.now());
  const [stickBottom, setStickBottom] = createSignal(true);
  let drawerEl: HTMLElement | undefined;

  const selectedKey = () => {
    const run = selected();
    return run ? runId(run) || runIssueId(run) : "";
  };

  const online = createMemo(() => (health()?.status ?? "loading") === "ok");
  const logItems = createMemo(() => transcriptItems(logs()));

  const onDrawerScroll = () => {
    const el = drawerEl;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickBottom(distance < 48);
  };

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied((c) => (c === value ? undefined : c)), 1200);
  };

  const load = async () => {
    try {
      const [nextHealth, runs] = await Promise.all([
        fetchOrchestratorHealth(),
        fetchOrchestratorRuns(),
      ]);
      setHealth(nextHealth);
      setActive(runs.active ?? []);
      setRecent(runs.recent ?? []);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadSelected = async () => {
    const key = selectedKey();
    if (!key) return;
    try {
      const [detail, nextWorkflow] = await Promise.all([
        fetchOrchestratorRun(key, 0, projectFromRun(selected())),
        fetchOrchestratorWorkflow(projectFromRun(selected())),
      ]);
      setEvents(detail.events ?? []);
      setWorkflow(nextWorkflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadLogs = async () => {
    const key = selectedKey();
    if (!key) return;
    try {
      const response = await fetchOrchestratorLogs(key, logCursor(), projectFromRun(selected()));
      setLogCursor(response.cursor ?? logCursor());
      if (response.events?.length) {
        setLogs((current) => [...current, ...response.events]);
      }
    } catch (err) {
      setLogs((current) => [
        ...current,
        { type: "error", text: err instanceof Error ? err.message : String(err) },
      ]);
    }
  };

  createEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const unsubscribe = subscribeToRealtime({
      interests: [{ type: "orchestrator" }],
      onEvent: () => {
        void load();
        void loadSelected();
      },
      onReconnect: () => void load(),
    });
    onCleanup(() => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      unsubscribe();
    });
  });

  createEffect(() => {
    selectedKey();
    setEvents([]);
    setLogs([]);
    setLogCursor(0);
    setStickBottom(true);
    void loadSelected();
  });

  createEffect(() => {
    logItems().length;
    if (tab() !== "logs" || !stickBottom() || !drawerEl) return;
    requestAnimationFrame(() => {
      if (drawerEl && stickBottom()) drawerEl.scrollTop = drawerEl.scrollHeight;
    });
  });

  createEffect(() => {
    if (!selectedKey() || tab() !== "logs") return;
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (!selectedKey() || tab() !== "events") return;
    void loadSelected();
    const timer = window.setInterval(() => void loadSelected(), 3000);
    onCleanup(() => window.clearInterval(timer));
  });

  const interrupt = async (id: string, project?: string) => {
    await interruptOrchestratorRun(id, project);
    await load();
    await loadSelected();
  };

  const kill = async (id: string, project?: string) => {
    await killOrchestratorRun(id, project);
    await load();
    setSelected(undefined);
  };

  return (
    <div class="orch-root">
      <style>{ORCH_STYLES}</style>

      <header class="orch-header">
        <div class="orch-title">
          <span class="orch-status-dot" classList={{ "orch-pulse": online(), off: !online() }} />
          <h1>Orchestrator</h1>
          <span class="orch-status-word" data-on={online()}>
            {online() ? "online" : health()?.status ?? "loading"}
          </span>
        </div>
        <div class="orch-stats">
          <div class="orch-stat">
            <span class="orch-stat-num">{health()?.activeClaims ?? active().length}</span>
            <span class="orch-stat-label">active</span>
          </div>
          <div class="orch-stat">
            <span class="orch-stat-num">{recent().length}</span>
            <span class="orch-stat-label">recent</span>
          </div>
          <div class="orch-stat orch-stat-tick">
            <span class="orch-stat-num">{relTime(health()?.lastTickAt, now())}</span>
            <span class="orch-stat-label">last tick</span>
          </div>
          <div class="orch-stat">
            <span class="orch-stat-num">{health()?.rateLimitRemaining ?? "—"}</span>
            <span class="orch-stat-label">rate limit</span>
          </div>
          <button class="orch-btn" onClick={() => void load()}>Refresh</button>
        </div>
      </header>

      <Show when={error()}>
        <div class="orch-error">{error()}</div>
      </Show>

      <section class="orch-section">
        <div class="orch-section-head">
          <h2>Active runs</h2>
          <Show when={active().length}>
            <span class="orch-count">{active().length}</span>
          </Show>
        </div>
        <Show
          when={active().length}
          fallback={
            <div class="orch-empty">
              <span class="orch-empty-dot" />
              <div>
                <strong>Idle, nothing running.</strong>
                <p>The daemon is polling Linear. Claimed work shows up here live.</p>
              </div>
            </div>
          }
        >
          <div class="orch-live-list">
            <For each={active()}>
              {(claim) => {
                const issueId = runIssueId(claim);
                const id = runId(claim) || issueId;
                const project = projectFromRun(claim);
                return (
                  <div class="orch-live-row" onClick={() => setSelected(claim)}>
                    <StatusPill tone="live" label="running" />
                    <div class="orch-live-main">
                      <div class="orch-live-id">{displayId(claim)}</div>
                      <div class="orch-live-meta">
                        <Show when={project}>
                          <span class="orch-chip">{project}</span>
                        </Show>
                        <span class="orch-mono" title={id} onClick={(e) => { e.stopPropagation(); copy(id); }}>
                          {copied() === id ? "copied" : shortRunId(id)}
                        </span>
                      </div>
                    </div>
                    <div class="orch-live-elapsed" title={`Last activity ${absTime(claim.lastEventAt ?? claim.claimedAt)}`}>
                      <span class="orch-live-elapsed-label">activity</span>
                      {relTime(claim.lastEventAt ?? claim.claimedAt, now())}
                    </div>
                    <div class="orch-row-actions" onClick={(e) => e.stopPropagation()}>
                      <button class="orch-btn" onClick={() => setSelected(claim)}>Open</button>
                      <button class="orch-btn" title="Interrupt (keep workspace)" onClick={() => void interrupt(id, project)}>⏸</button>
                      <button class="orch-btn orch-btn-danger" title="Kill (interrupt + cleanup)" onClick={() => void kill(id, project)}>✕</button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <section class="orch-section">
        <div class="orch-section-head">
          <h2>Recent runs</h2>
          <Show when={recent().length}>
            <span class="orch-count">{recent().length}</span>
          </Show>
        </div>
        <Show
          when={recent().length}
          fallback={<div class="orch-empty"><div><strong>No runs yet.</strong><p>History lands here once the daemon dispatches work.</p></div></div>}
        >
          <div class="orch-recent-list">
            <For each={recent()}>
              {(run) => {
                const id = runId(run);
                const project = run.project_id ?? run.projectId;
                return (
                  <div class="orch-recent-row" onClick={() => setSelected(run)}>
                    <StatusPill tone={outcomeTone(run)} label={outcomeLabel(run)} title={run.outcome ?? undefined} />
                    <span class="orch-recent-id">{displayId(run)}</span>
                    <span class="orch-mono orch-recent-hash" title={id} onClick={(e) => { e.stopPropagation(); copy(id); }}>
                      {copied() === id ? "copied" : shortRunId(id)}
                    </span>
                    <Show when={project} fallback={<span class="orch-recent-proj orch-dim">—</span>}>
                      <span class="orch-recent-proj">{project}</span>
                    </Show>
                    <span class="orch-recent-time" title={absTime(run.startedAt ?? run.started_at)}>
                      {relTime(run.startedAt ?? run.started_at, now())}
                    </span>
                    <span class="orch-recent-exit orch-dim">
                      <Show when={(run.exitCode ?? run.exit_code) != null} fallback="">
                        exit {run.exitCode ?? run.exit_code}
                      </Show>
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <Show when={selected()}>
        {(run) => {
          const key = () => runId(run()) || runIssueId(run());
          return (
            <>
              <div class="orch-scrim" onClick={() => setSelected(undefined)} />
              <aside class="orch-drawer" ref={(el) => (drawerEl = el)} onScroll={onDrawerScroll}>
                <div class="orch-drawer-head">
                  <div class="orch-drawer-titles">
                    <h2>{displayId(run())}</h2>
                    <span class="orch-mono orch-drawer-key" title={key()} onClick={() => copy(key())}>
                      {copied() === key() ? "copied" : shortRunId(key())}
                    </span>
                  </div>
                  <button class="orch-btn" onClick={() => setSelected(undefined)}>Close</button>
                </div>
                <nav class="orch-tabs">
                  <For each={["logs", "events", "workflow"] as const}>
                    {(item) => (
                      <button class="orch-tab" aria-pressed={tab() === item} onClick={() => setTab(item)}>
                        {item}
                      </button>
                    )}
                  </For>
                </nav>

                <Show when={tab() === "logs"}>
                  <Show when={logItems().length} fallback={<div class="orch-quiet">No logs yet.</div>}>
                    <AgentTranscriptLog items={logItems()} agentName="Agent" />
                  </Show>
                </Show>

                <Show when={tab() === "events"}>
                  <Show when={events().length} fallback={<div class="orch-quiet">No events yet.</div>}>
                    <div class="orch-events">
                      <For each={events()}>
                        {(event) => (
                          <article class="orch-event">
                            <div class="orch-event-head">
                              <span class="orch-event-type">{event.type ?? "event"}</span>
                              <span class="orch-event-time">{relTime(event.created_at, now())}</span>
                            </div>
                            <pre class="orch-event-body">{eventPayload(event)}</pre>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>

                <Show when={tab() === "workflow"}>
                  <div class="orch-workflow">
                    <div class="orch-wf-meta">
                      <span class="orch-mono">{workflow()?.path ?? "fallback workflow"}</span>
                      <Show when={workflow()?.sha}>
                        <span class="orch-chip">{shortRunId(String(workflow()?.sha))}</span>
                      </Show>
                    </div>
                    <h3>Frontmatter</h3>
                    <pre class="orch-code">{JSON.stringify(workflow()?.frontmatter ?? {}, null, 2)}</pre>
                    <h3>Body</h3>
                    <pre class="orch-code">{workflow()?.body ?? ""}</pre>
                  </div>
                </Show>
              </aside>
            </>
          );
        }}
      </Show>
    </div>
  );
}

const ORCH_STYLES = `
.orch-root {
  --orch-ok: #22c55e;
  --orch-warn: #f59e0b;
  --orch-fail: #ef4444;
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 64px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
[data-theme="light"] .orch-root {
  --orch-ok: #15803d;
  --orch-warn: #b45309;
  --orch-fail: #dc2626;
}
.orch-root h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.orch-root h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
.orch-root h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); margin: 4px 0; }

.orch-header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 14px;
}
.orch-title { display: flex; align-items: center; gap: 11px; min-width: 0; }
.orch-status-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--orch-ok);
  flex-shrink: 0;
}
.orch-status-dot.off { background: var(--text-muted); }
.orch-status-word {
  font-size: 12px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.orch-status-word[data-on="true"] { color: var(--orch-ok); }

.orch-stats { display: flex; align-items: center; gap: 8px; }
.orch-stat {
  display: flex; flex-direction: column; align-items: flex-end;
  padding: 4px 12px; border-left: 1px solid var(--border-subtle);
}
.orch-stat-num { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.orch-stat-tick .orch-stat-num { font-size: 14px; color: var(--text-secondary); }
.orch-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

.orch-section { display: flex; flex-direction: column; gap: 12px; }
.orch-section-head { display: flex; align-items: center; gap: 9px; }
.orch-count {
  font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  background: var(--bg-raised); border-radius: 999px; padding: 1px 8px;
}

.orch-error {
  color: var(--tone-error);
  background: color-mix(in srgb, var(--tone-error) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone-error) 35%, transparent);
  padding: 11px 14px; border-radius: 10px; font-size: 13px;
}

/* pills */
.orch-pill {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.01em;
  padding: 3px 9px 3px 8px; border-radius: 999px; white-space: nowrap;
  text-transform: capitalize;
  border: 1px solid transparent;
}
.orch-pill-glyph { font-size: 9px; line-height: 1; flex-shrink: 0; }
.orch-pill-text { overflow: hidden; text-overflow: ellipsis; }
.orch-pill[data-tone="live"] { color: var(--orch-ok); background: color-mix(in srgb, var(--orch-ok) 12%, transparent); border-color: color-mix(in srgb, var(--orch-ok) 30%, transparent); }
.orch-pill[data-tone="ok"]   { color: var(--orch-ok); background: color-mix(in srgb, var(--orch-ok) 9%, transparent); border-color: color-mix(in srgb, var(--orch-ok) 22%, transparent); }
.orch-pill[data-tone="fail"] { color: var(--orch-fail); background: color-mix(in srgb, var(--orch-fail) 11%, transparent); border-color: color-mix(in srgb, var(--orch-fail) 28%, transparent); }
.orch-pill[data-tone="warn"] { color: var(--orch-warn); background: color-mix(in srgb, var(--orch-warn) 11%, transparent); border-color: color-mix(in srgb, var(--orch-warn) 28%, transparent); }
.orch-pill[data-tone="muted"]{ color: var(--text-tertiary); background: var(--bg-raised); border-color: var(--border-subtle); }

/* active live rows */
.orch-live-list { display: flex; flex-direction: column; gap: 8px; }
.orch-live-row {
  display: flex; align-items: center; gap: 14px;
  padding: 13px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 12px; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.orch-live-row:hover { border-color: var(--subagent-border); background: var(--bg-raised); }
.orch-live-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.orch-live-id { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.orch-live-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.orch-live-elapsed {
  display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--text-secondary); flex-shrink: 0;
}
.orch-live-elapsed-label {
  font-size: 10px; font-weight: 500; letter-spacing: .03em; text-transform: uppercase;
  color: var(--text-tertiary);
}

.orch-chip {
  font-size: 11px; color: var(--subagent-text);
  background: var(--subagent-bg); border: 1px solid var(--subagent-border);
  border-radius: 6px; padding: 1px 7px; white-space: nowrap;
}
.orch-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; color: var(--text-muted); cursor: copy;
}
.orch-mono:hover { color: var(--text-secondary); }

.orch-row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

/* recent rows */
.orch-recent-list { display: flex; flex-direction: column; }
.orch-recent-row {
  display: grid;
  grid-template-columns: 138px 1fr auto 150px 64px 70px;
  align-items: center; gap: 12px;
  padding: 11px 14px; cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 110ms ease;
}
.orch-recent-row:first-child { border-top: 1px solid var(--border-subtle); }
.orch-recent-row:hover { background: var(--bg-surface); }
.orch-recent-id { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.orch-recent-hash { justify-self: start; }
.orch-recent-proj { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.orch-recent-time { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; text-align: right; }
.orch-recent-exit { font-size: 11px; text-align: right; }
.orch-dim { color: var(--text-muted); }

/* empty */
.orch-empty {
  display: flex; align-items: center; gap: 14px;
  padding: 22px 20px;
  background: var(--bg-surface);
  border: 1px dashed var(--border-default);
  border-radius: 12px; color: var(--text-secondary);
}
.orch-empty strong { color: var(--text-primary); font-size: 14px; font-weight: 600; }
.orch-empty p { font-size: 12.5px; color: var(--text-muted); margin-top: 3px; }
.orch-empty-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-muted); opacity: 0.6;
}

/* buttons */
.orch-btn {
  font-family: inherit; font-size: 12.5px; font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: 8px; padding: 5px 11px; cursor: pointer;
  transition: background 110ms ease, color 110ms ease, border-color 110ms ease;
}
.orch-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
.orch-btn-danger:hover { color: var(--orch-fail); border-color: color-mix(in srgb, var(--orch-fail) 50%, transparent); background: color-mix(in srgb, var(--orch-fail) 9%, transparent); }

/* drawer */
.orch-scrim {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 999; animation: orch-fade 140ms ease;
}
.orch-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(640px, 100vw);
  background: var(--bg-surface);
  border-left: 1px solid var(--border-default);
  box-shadow: -24px 0 60px var(--shadow-md);
  z-index: 1000; overflow: auto; padding: 20px 22px;
  display: flex; flex-direction: column; gap: 16px;
  animation: orch-slide 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.orch-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.orch-drawer-titles { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.orch-drawer-titles h2 {
  font-size: 18px; font-weight: 700; text-transform: none; letter-spacing: -0.01em;
  color: var(--text-primary);
}
.orch-drawer-key { word-break: break-all; }

.orch-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border-subtle); }
.orch-tab {
  font-family: inherit; font-size: 12.5px; font-weight: 500; text-transform: capitalize;
  color: var(--text-muted); background: transparent; border: none; cursor: pointer;
  padding: 8px 12px; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 110ms ease, border-color 110ms ease;
}
.orch-tab:hover { color: var(--text-secondary); }
.orch-tab[aria-pressed="true"] { color: var(--text-primary); border-bottom-color: var(--subagent-text); }

.orch-quiet { color: var(--text-muted); font-size: 13px; padding: 12px 2px; }


.orch-events { display: flex; flex-direction: column; gap: 9px; }
.orch-event {
  background: var(--bg-inset); border: 1px solid var(--border-subtle);
  border-radius: 10px; padding: 11px 13px;
}
.orch-event-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.orch-event-type { font-size: 12px; font-weight: 600; color: var(--text-primary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.orch-event-time { font-size: 11px; color: var(--text-muted); }
.orch-event-body, .orch-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; line-height: 1.6; color: var(--text-secondary);
  white-space: pre-wrap; overflow-wrap: anywhere; margin: 0;
}
.orch-workflow { display: flex; flex-direction: column; gap: 10px; }
.orch-wf-meta { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.orch-code {
  background: var(--bg-inset); border: 1px solid var(--border-subtle);
  border-radius: 10px; padding: 12px 13px;
}

.orch-pulse { animation: orch-pulse 1.8s ease-in-out infinite; }
@keyframes orch-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes orch-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes orch-slide { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

@media (max-width: 720px) {
  .orch-header { flex-direction: column; align-items: stretch; gap: 14px; }
  .orch-stats { justify-content: space-between; }
  .orch-recent-row { grid-template-columns: 110px 1fr auto 64px; }
  .orch-recent-hash, .orch-recent-proj { display: none; }
  .orch-live-row { flex-wrap: wrap; }
}
`;

function OrchestratorRouteShell() {
  return (
    <LeftNavShell>
      <OrchestratorDashboard />
    </LeftNavShell>
  );
}

export const webRouteExtension: {
  extensionId: string;
  routes: { path: string; component: Component }[];
} = {
  extensionId: "orchestrator",
  routes: [{ path: "/orchestrator", component: OrchestratorRouteShell }],
};
