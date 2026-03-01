import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  commitProjectChanges,
  fetchProjectChanges,
  fetchProjectSpace,
} from "../../api/client";
import type {
  FileChange,
  ProjectChanges,
  ProjectSpaceState,
} from "../../api/types";

type ChangesViewProps = {
  projectId: string;
};

type DiffLine = {
  kind: "add" | "del" | "meta" | "ctx";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

type DiffFile = {
  path: string;
  lines: DiffLine[];
};

function parseDiff(diff: string): DiffFile[] {
  const rows = diff.split(/\r?\n/);
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const row of rows) {
    if (row.startsWith("diff --git ")) {
      const match = row.match(/^diff --git a\/(.+) b\/(.+)$/);
      const path = match?.[2] ?? row;
      current = {
        path,
        lines: [{ kind: "meta", text: row, oldLine: null, newLine: null }],
      };
      files.push(current);
      oldLine = null;
      newLine = null;
      continue;
    }

    if (!current) continue;

    if (row.startsWith("@@ ")) {
      const match = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
      newLine = match ? Number(match[2]) : null;
      current.lines.push({
        kind: "meta",
        text: row,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    if (row.startsWith("+") && !row.startsWith("+++")) {
      current.lines.push({
        kind: "add",
        text: row,
        oldLine: null,
        newLine,
      });
      if (newLine !== null) newLine += 1;
      continue;
    }

    if (row.startsWith("-") && !row.startsWith("---")) {
      current.lines.push({
        kind: "del",
        text: row,
        oldLine,
        newLine: null,
      });
      if (oldLine !== null) oldLine += 1;
      continue;
    }

    const isMeta =
      row.startsWith("index ") ||
      row.startsWith("---") ||
      row.startsWith("+++") ||
      row.startsWith("new file") ||
      row.startsWith("deleted file") ||
      row.startsWith("rename ");

    if (isMeta) {
      current.lines.push({
        kind: "meta",
        text: row,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    const line: DiffLine = {
      kind: "ctx",
      text: row,
      oldLine,
      newLine,
    };
    current.lines.push(line);
    if (row.startsWith("\\")) continue;
    if (oldLine !== null) oldLine += 1;
    if (newLine !== null) newLine += 1;
  }

  return files;
}

function statusGlyph(change: FileChange): string {
  if (change.status === "added") return "+";
  if (change.status === "deleted") return "-";
  if (change.status === "renamed") return "R";
  return "M";
}

export function ChangesView(props: ChangesViewProps) {
  const [changes, setChanges] = createSignal<ProjectChanges | null>(null);
  const [space, setSpace] = createSignal<ProjectSpaceState | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [commitMessage, setCommitMessage] = createSignal("");
  const [commitError, setCommitError] = createSignal<string | null>(null);
  const [committing, setCommitting] = createSignal(false);
  const [autoCommit, setAutoCommit] = createSignal(false);
  const fileRefs = new Map<string, HTMLElement>();

  const refresh = async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [changesData, spaceData] = await Promise.all([
        fetchProjectChanges(props.projectId),
        fetchProjectSpace(props.projectId).catch(() => null),
      ]);
      setChanges(changesData);
      setSpace(spaceData);
      setLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch changes";
      setLoadError(message);
    } finally {
      if (initial) setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (committing()) return;
    const message = commitMessage().trim();
    if (!message) {
      setCommitError("Commit message is required");
      return;
    }
    setCommitting(true);
    setCommitError(null);
    const result = await commitProjectChanges(props.projectId, message);
    setCommitting(false);
    if (!result.ok) {
      setCommitError(result.error ?? "Failed to commit changes");
      return;
    }
    setCommitMessage("");
    await refresh(false);
  };

  onMount(() => {
    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh(false);
    }, 15_000);
    onCleanup(() => window.clearInterval(timer));
  });

  const diffFiles = () => parseDiff(changes()?.diff ?? "");
  const sourceLabel = () =>
    changes()?.source?.type === "space" ? "Space" : "Repo";
  const queueCounts = () => {
    const items = space()?.queue ?? [];
    let pending = 0;
    let integrated = 0;
    let conflict = 0;
    for (const item of items) {
      if (item.status === "pending") pending += 1;
      else if (item.status === "integrated") integrated += 1;
      else if (item.status === "conflict") conflict += 1;
    }
    return { pending, integrated, conflict };
  };

  return (
    <section class="changes-view">
      <Show
        when={!loading()}
        fallback={<div class="changes-loading">Loading changes…</div>}
      >
        <Show
          when={!loadError()}
          fallback={<p class="changes-error">{loadError()}</p>}
        >
          <Show
            when={(changes()?.files.length ?? 0) > 0}
            fallback={<div class="changes-empty">No uncommitted changes</div>}
          >
            <header class="changes-header">
              <div class="changes-branch">
                <span>Branch: {changes()?.branch ?? "-"}</span>
                <span class="changes-base">
                  ← {changes()?.baseBranch ?? "main"}
                </span>
                <span class={`changes-source source-${sourceLabel().toLowerCase()}`}>
                  {sourceLabel()}
                </span>
              </div>
              <div class="changes-stats">
                <span>{changes()?.stats.filesChanged ?? 0} files</span>
                <span class="ins">+{changes()?.stats.insertions ?? 0}</span>
                <span class="del">-{changes()?.stats.deletions ?? 0}</span>
              </div>
            </header>
            <Show when={space()}>
              <div class="space-meta">
                <span>Queue: {queueCounts().pending} pending</span>
                <span>Integrated: {queueCounts().integrated}</span>
                <span class="space-conflicts">
                  Conflicts: {queueCounts().conflict}
                </span>
              </div>
            </Show>
            <Show when={space()?.integrationBlocked}>
              <p class="changes-error">
                Space integration blocked by conflict. Resolve manually, then
                retry integration.
              </p>
            </Show>

            <div class="changes-main">
              <aside class="changes-files">
                <h4>Files</h4>
                <ul>
                  <For each={changes()?.files ?? []}>
                    {(file) => (
                      <li>
                        <button
                          type="button"
                          class={`file-row status-${file.status}`}
                          onClick={() => {
                            const target = fileRefs.get(file.path);
                            if (target) {
                              target.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }
                          }}
                        >
                          <span class="file-glyph">{statusGlyph(file)}</span>
                          <span class="file-path">{file.path}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </aside>

              <div class="changes-diff">
                <For each={diffFiles()}>
                  {(file) => (
                    <section
                      class="diff-file"
                      ref={(el) => fileRefs.set(file.path, el)}
                    >
                      <div class="diff-file-title">{file.path}</div>
                      <pre class="diff-block">
                        <For each={file.lines}>
                          {(line) => (
                            <div class={`diff-line line-${line.kind}`}>
                              <span class="line-num">{line.oldLine ?? ""}</span>
                              <span class="line-num">{line.newLine ?? ""}</span>
                              <span class="line-text">{line.text || " "}</span>
                            </div>
                          )}
                        </For>
                      </pre>
                    </section>
                  )}
                </For>
              </div>
            </div>

            <footer class="changes-footer">
              <label class="auto-commit-toggle">
                <input
                  type="checkbox"
                  checked={autoCommit()}
                  onInput={(e) => setAutoCommit(e.currentTarget.checked)}
                />
                Auto-commit
              </label>
              <button type="button" class="pr-btn" disabled>
                Create PR
              </button>
              <input
                class="commit-input"
                placeholder="Commit message"
                value={commitMessage()}
                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                disabled={committing()}
              />
              <button
                type="button"
                class="commit-btn"
                disabled={committing()}
                onClick={() => void handleCommit()}
              >
                {committing() ? "Committing…" : "Commit"}
              </button>
            </footer>
            <Show when={commitError()}>
              <p class="changes-error">{commitError()}</p>
            </Show>
          </Show>
        </Show>
      </Show>

      <style>{`
        .changes-view {
          min-height: 100%;
          display: grid;
          grid-template-rows: 1fr;
        }

        .changes-loading,
        .changes-empty {
          height: 100%;
          display: grid;
          place-items: center;
          color: #8a94a6;
        }

        .changes-error {
          margin-top: 8px;
          color: #fda4af;
          font-size: 12px;
        }

        .changes-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #111722;
          padding: 10px 12px;
          margin-bottom: 12px;
        }

        .changes-branch,
        .changes-stats {
          display: flex;
          gap: 10px;
          align-items: center;
          font-size: 12px;
        }

        .changes-base {
          color: #94a3b8;
        }

        .changes-source {
          border: 1px solid #334155;
          border-radius: 999px;
          padding: 1px 8px;
          font-size: 11px;
        }

        .source-space {
          color: #93c5fd;
          border-color: #1d4ed8;
          background: rgba(29, 78, 216, 0.14);
        }

        .source-repo {
          color: #94a3b8;
          background: rgba(100, 116, 139, 0.14);
        }

        .changes-stats .ins {
          color: #34d399;
        }

        .changes-stats .del {
          color: #fb7185;
        }

        .space-meta {
          display: flex;
          gap: 10px;
          margin: -2px 0 10px;
          font-size: 12px;
          color: #94a3b8;
        }

        .space-conflicts {
          color: #fda4af;
        }

        .changes-main {
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #0f1522;
          min-height: 440px;
          display: grid;
          grid-template-columns: 220px 1fr;
          overflow: hidden;
        }

        .changes-files {
          border-right: 1px solid #1f2937;
          padding: 10px;
          overflow: auto;
        }

        .changes-files h4 {
          margin: 0 0 10px;
          font-size: 12px;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .changes-files ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 4px;
        }

        .file-row {
          width: 100%;
          border: 1px solid transparent;
          background: transparent;
          color: #d4d4d8;
          border-radius: 8px;
          text-align: left;
          padding: 6px 8px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .file-row:hover {
          border-color: #334155;
          background: #131e31;
        }

        .file-glyph {
          width: 16px;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
        }

        .status-modified .file-glyph {
          color: #facc15;
        }

        .status-added .file-glyph {
          color: #4ade80;
        }

        .status-deleted .file-glyph {
          color: #fb7185;
        }

        .status-renamed .file-glyph {
          color: #38bdf8;
        }

        .file-path {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 12px;
        }

        .changes-diff {
          overflow: auto;
          padding: 10px;
        }

        .diff-file {
          border: 1px solid #1f2937;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 10px;
          background: #0b1220;
        }

        .diff-file-title {
          font-size: 12px;
          color: #94a3b8;
          background: #121a2b;
          padding: 6px 10px;
          border-bottom: 1px solid #1f2937;
        }

        .diff-block {
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
          line-height: 1.45;
          overflow: auto;
        }

        .diff-line {
          display: grid;
          grid-template-columns: 48px 48px 1fr;
          align-items: baseline;
        }

        .line-num {
          color: #64748b;
          text-align: right;
          padding: 0 8px 0 0;
          user-select: none;
        }

        .line-text {
          white-space: pre;
          padding: 0 10px 0 0;
        }

        .line-add {
          background: rgba(34, 197, 94, 0.16);
        }

        .line-del {
          background: rgba(244, 63, 94, 0.16);
        }

        .line-meta {
          color: #93c5fd;
          background: rgba(30, 64, 175, 0.14);
        }

        .changes-footer {
          margin-top: 10px;
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #111722;
          padding: 10px;
          display: grid;
          grid-template-columns: auto auto 1fr auto;
          gap: 10px;
          align-items: center;
        }

        .auto-commit-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #cbd5e1;
        }

        .pr-btn,
        .commit-btn {
          border: 1px solid #3b82f6;
          background: #1d4ed8;
          color: #fff;
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .pr-btn:disabled,
        .commit-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .commit-input {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #334155;
          background: #0f172a;
          color: #e2e8f0;
          padding: 8px 10px;
          font-size: 13px;
        }

        .commit-input:focus {
          outline: none;
          border-color: #3b82f6;
        }
      `}</style>
    </section>
  );
}
