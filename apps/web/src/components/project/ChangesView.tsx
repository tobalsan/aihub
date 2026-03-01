import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  commitProjectChanges,
  fetchProjectChanges,
  fetchProjectPullRequestTarget,
  fetchProjectSpace,
  fetchProjectSpaceCommits,
  fetchProjectSpaceContribution,
  integrateProjectSpace,
  spawnSpaceConflictFixer,
} from "../../api/client";
import type {
  FileChange,
  ProjectChanges,
  ProjectPullRequestTarget,
  ProjectSpaceState,
  SpaceCommitSummary,
  SpaceContribution,
  SpaceIntegrationEntry,
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

function queueStatusLabel(status: SpaceIntegrationEntry["status"]): string {
  if (status === "pending") return "Pending";
  if (status === "integrated") return "Integrated";
  if (status === "conflict") return "Conflict";
  if (status === "stale_worker") return "Stale";
  return "Skipped";
}

function formatWhen(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ChangesView(props: ChangesViewProps) {
  const [changes, setChanges] = createSignal<ProjectChanges | null>(null);
  const [space, setSpace] = createSignal<ProjectSpaceState | null>(null);
  const [spaceCommits, setSpaceCommits] = createSignal<SpaceCommitSummary[]>([]);
  const [prTarget, setPrTarget] = createSignal<ProjectPullRequestTarget | null>(
    null
  );
  const [contributions, setContributions] = createSignal<
    Record<string, SpaceContribution>
  >({});
  const [entryErrors, setEntryErrors] = createSignal<Record<string, string>>({});
  const [expandedEntries, setExpandedEntries] = createSignal<
    Record<string, boolean>
  >({});

  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [loadingEntryId, setLoadingEntryId] = createSignal<string | null>(null);

  const [integrating, setIntegrating] = createSignal(false);
  const [integrateError, setIntegrateError] = createSignal<string | null>(null);

  const [commitMessage, setCommitMessage] = createSignal("");
  const [commitError, setCommitError] = createSignal<string | null>(null);
  const [committing, setCommitting] = createSignal(false);
  const [autoCommit, setAutoCommit] = createSignal(false);

  const [fixingEntryId, setFixingEntryId] = createSignal<string | null>(null);
  const [fixMessage, setFixMessage] = createSignal<string | null>(null);
  const [fixError, setFixError] = createSignal<string | null>(null);

  const fileRefs = new Map<string, HTMLElement>();

  const refresh = async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [changesData, spaceData, commitsData, prData] = await Promise.all([
        fetchProjectChanges(props.projectId),
        fetchProjectSpace(props.projectId).catch(() => null),
        fetchProjectSpaceCommits(props.projectId).catch(() => []),
        fetchProjectPullRequestTarget(props.projectId).catch(() => null),
      ]);
      setChanges(changesData);
      setSpace(spaceData);
      setSpaceCommits(commitsData);
      setPrTarget(prData);
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

  const handleIntegrate = async () => {
    if (integrating()) return;
    setIntegrating(true);
    setIntegrateError(null);
    try {
      const updated = await integrateProjectSpace(props.projectId);
      setSpace(updated);
      await refresh(false);
    } catch (error) {
      setIntegrateError(
        error instanceof Error ? error.message : "Failed to integrate Space"
      );
    } finally {
      setIntegrating(false);
    }
  };

  const handleToggleEntry = async (entry: SpaceIntegrationEntry) => {
    const isOpen = expandedEntries()[entry.id] === true;
    const next = { ...expandedEntries(), [entry.id]: !isOpen };
    setExpandedEntries(next);
    if (isOpen) return;
    if (contributions()[entry.id]) return;

    setLoadingEntryId(entry.id);
    setEntryErrors((prev) => ({ ...prev, [entry.id]: "" }));
    try {
      const contribution = await fetchProjectSpaceContribution(
        props.projectId,
        entry.id
      );
      setContributions((prev) => ({ ...prev, [entry.id]: contribution }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch contribution details";
      setEntryErrors((prev) => ({ ...prev, [entry.id]: message }));
    } finally {
      setLoadingEntryId(null);
    }
  };

  const handleSpawnFixer = async (entryId: string) => {
    if (fixingEntryId()) return;
    setFixMessage(null);
    setFixError(null);
    setFixingEntryId(entryId);
    try {
      const result = await spawnSpaceConflictFixer(props.projectId, entryId);
      setFixMessage(`Spawned fixer: ${result.slug}`);
    } catch (error) {
      setFixError(
        error instanceof Error ? error.message : "Failed to spawn conflict fixer"
      );
    } finally {
      setFixingEntryId(null);
    }
  };

  const handleCreatePr = () => {
    const url = prTarget()?.compareUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener");
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

  const queueCounts = createMemo(() => {
    const items = space()?.queue ?? [];
    let pending = 0;
    let integrated = 0;
    let conflict = 0;
    let stale = 0;
    for (const item of items) {
      if (item.status === "pending") pending += 1;
      else if (item.status === "integrated") integrated += 1;
      else if (item.status === "conflict") conflict += 1;
      else if (item.status === "stale_worker") stale += 1;
    }
    return { pending, integrated, conflict, stale };
  });

  const workerGroups = createMemo(() => {
    const groups = new Map<string, SpaceIntegrationEntry[]>();
    for (const item of space()?.queue ?? []) {
      const key = item.workerSlug || "unknown";
      const rows = groups.get(key) ?? [];
      rows.push(item);
      groups.set(key, rows);
    }
    return Array.from(groups.entries()).map(([worker, entries]) => ({
      worker,
      entries,
    }));
  });

  const canIntegrate = () => {
    const counts = queueCounts();
    return counts.pending > 0 || Boolean(space()?.integrationBlocked);
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
          <header class="changes-header">
            <div class="changes-branch">
              <span>Branch: {changes()?.branch ?? "-"}</span>
              <span class="changes-base">← {changes()?.baseBranch ?? "main"}</span>
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
            <section class="space-dashboard">
              <div class="space-head">
                <div class="space-meta">
                  <span>Space branch: {space()?.branch}</span>
                  <span>Base: {space()?.baseBranch}</span>
                  <span>Pending: {queueCounts().pending}</span>
                  <span>Integrated: {queueCounts().integrated}</span>
                  <span class="space-conflicts">Conflicts: {queueCounts().conflict}</span>
                  <span class="space-stale">Stale: {queueCounts().stale}</span>
                </div>
                <button
                  type="button"
                  class="integrate-btn"
                  disabled={!canIntegrate() || integrating()}
                  onClick={() => void handleIntegrate()}
                >
                  {integrating() ? "Integrating…" : "Integrate Now"}
                </button>
              </div>
              <Show when={space()?.integrationBlocked}>
                <p class="changes-error">
                  Space integration is blocked by a conflict. Resolve conflicts or spawn
                  a fixer worker.
                </p>
              </Show>
              <Show when={integrateError()}>
                <p class="changes-error">{integrateError()}</p>
              </Show>
              <Show when={fixMessage()}>
                <p class="changes-info">{fixMessage()}</p>
              </Show>
              <Show when={fixError()}>
                <p class="changes-error">{fixError()}</p>
              </Show>

              <Show when={workerGroups().length > 0}>
                <div class="worker-groups">
                  <For each={workerGroups()}>
                    {(group) => (
                      <details class="worker-group" open>
                        <summary>
                          {group.worker} <span>{group.entries.length} entries</span>
                        </summary>
                        <For each={group.entries}>
                          {(entry) => (
                            <div class="entry-card">
                              <div class="entry-row">
                                <span
                                  class={`entry-status status-${entry.status.replace("_", "-")}`}
                                >
                                  {queueStatusLabel(entry.status)}
                                </span>
                                <span>{entry.runMode}</span>
                                <span>{entry.shas.length} commits</span>
                                <span>Created: {formatWhen(entry.createdAt)}</span>
                                <Show when={entry.integratedAt}>
                                  <span>Integrated: {formatWhen(entry.integratedAt)}</span>
                                </Show>
                              </div>
                              <Show when={entry.staleAgainstSha}>
                                <div class="entry-note">
                                  stale vs {entry.staleAgainstSha}
                                </div>
                              </Show>
                              <Show when={entry.error}>
                                <div class="entry-note">{entry.error}</div>
                              </Show>
                              <div class="entry-actions">
                                <button
                                  type="button"
                                  class="entry-btn"
                                  onClick={() => void handleToggleEntry(entry)}
                                >
                                  {expandedEntries()[entry.id] ? "Hide" : "Details"}
                                </button>
                                <Show when={entry.status === "conflict"}>
                                  <button
                                    type="button"
                                    class="entry-btn"
                                    disabled={fixingEntryId() === entry.id}
                                    onClick={() => void handleSpawnFixer(entry.id)}
                                  >
                                    {fixingEntryId() === entry.id
                                      ? "Spawning…"
                                      : "Spawn Conflict Fixer"}
                                  </button>
                                </Show>
                              </div>
                              <Show when={expandedEntries()[entry.id]}>
                                <div class="entry-details">
                                  <Show when={loadingEntryId() === entry.id}>
                                    <p class="entry-loading">Loading entry details…</p>
                                  </Show>
                                  <Show when={entryErrors()[entry.id]}>
                                    <p class="changes-error">{entryErrors()[entry.id]}</p>
                                  </Show>
                                  <Show when={contributions()[entry.id]}>
                                    {(detail) => (
                                      <>
                                        <Show when={detail().conflictFiles.length > 0}>
                                          <div class="entry-conflict-files">
                                            <strong>Conflict files:</strong>
                                            <ul>
                                              <For each={detail().conflictFiles}>
                                                {(file) => <li>{file}</li>}
                                              </For>
                                            </ul>
                                          </div>
                                        </Show>
                                        <Show when={detail().commits.length > 0}>
                                          <div class="entry-commits">
                                            <For each={detail().commits}>
                                              {(commit) => (
                                                <div class="commit-row">
                                                  <code>{commit.sha.slice(0, 7)}</code>
                                                  <span>{commit.subject}</span>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        </Show>
                                        <Show when={detail().diff.trim().length > 0}>
                                          <pre class="entry-diff">{detail().diff}</pre>
                                        </Show>
                                      </>
                                    )}
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </details>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Show>

          <Show when={spaceCommits().length > 0}>
            <section class="space-commit-log">
              <h4>Space Commit Log</h4>
              <For each={spaceCommits()}>
                {(commit) => (
                  <div class="space-commit-row">
                    <code>{commit.sha.slice(0, 7)}</code>
                    <span>{commit.subject}</span>
                    <span class="space-commit-meta">{commit.author}</span>
                  </div>
                )}
              </For>
            </section>
          </Show>

          <Show
            when={(changes()?.files.length ?? 0) > 0}
            fallback={<div class="changes-empty">No uncommitted changes</div>}
          >
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
              <button
                type="button"
                class="pr-btn"
                disabled={!prTarget()?.compareUrl}
                onClick={handleCreatePr}
              >
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
            <p class="changes-note">
              Commits and PRs target Space branch {space()?.branch ?? changes()?.branch}.
            </p>
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

        .changes-info {
          margin-top: 8px;
          color: #93c5fd;
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

        .space-dashboard {
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #0d1422;
          padding: 10px;
          margin-bottom: 10px;
          display: grid;
          gap: 8px;
        }

        .space-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .space-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 12px;
          color: #94a3b8;
        }

        .space-conflicts {
          color: #fda4af;
        }

        .space-stale {
          color: #fbbf24;
        }

        .integrate-btn,
        .entry-btn {
          border: 1px solid #2563eb;
          background: #1d4ed8;
          color: #fff;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          cursor: pointer;
        }

        .integrate-btn:disabled,
        .entry-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .worker-groups {
          display: grid;
          gap: 8px;
        }

        .worker-group {
          border: 1px solid #1f2937;
          border-radius: 8px;
          background: #0b1220;
          padding: 6px 8px;
        }

        .worker-group > summary {
          cursor: pointer;
          font-size: 12px;
          color: #e2e8f0;
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .worker-group > summary span {
          color: #94a3b8;
          font-size: 11px;
        }

        .entry-card {
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 8px;
          margin-top: 8px;
          background: #0b1220;
          display: grid;
          gap: 6px;
        }

        .entry-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11px;
          color: #cbd5e1;
        }

        .entry-status {
          border-radius: 999px;
          padding: 1px 8px;
          border: 1px solid #334155;
          color: #e2e8f0;
        }

        .status-pending {
          background: rgba(59, 130, 246, 0.18);
          border-color: #2563eb;
        }

        .status-integrated {
          background: rgba(34, 197, 94, 0.16);
          border-color: #16a34a;
        }

        .status-conflict {
          background: rgba(244, 63, 94, 0.16);
          border-color: #be123c;
        }

        .status-stale-worker {
          background: rgba(251, 191, 36, 0.16);
          border-color: #ca8a04;
        }

        .status-skipped {
          background: rgba(100, 116, 139, 0.2);
          border-color: #475569;
        }

        .entry-note {
          font-size: 11px;
          color: #fca5a5;
          white-space: pre-wrap;
        }

        .entry-actions {
          display: flex;
          gap: 8px;
        }

        .entry-details {
          border-top: 1px solid #1e293b;
          padding-top: 8px;
          display: grid;
          gap: 8px;
        }

        .entry-loading {
          margin: 0;
          color: #94a3b8;
          font-size: 12px;
        }

        .entry-conflict-files ul {
          margin: 4px 0 0 16px;
          padding: 0;
          color: #fca5a5;
          font-size: 12px;
        }

        .entry-commits {
          display: grid;
          gap: 4px;
        }

        .commit-row {
          display: grid;
          grid-template-columns: 60px 1fr;
          gap: 8px;
          font-size: 12px;
          color: #e2e8f0;
        }

        .entry-diff {
          margin: 0;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 8px;
          background: #020617;
          max-height: 280px;
          overflow: auto;
          font-size: 11px;
          line-height: 1.4;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
        }

        .space-commit-log {
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #0f1522;
          padding: 10px;
          margin-bottom: 10px;
          display: grid;
          gap: 6px;
        }

        .space-commit-log h4 {
          margin: 0 0 4px;
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #94a3b8;
        }

        .space-commit-row {
          display: grid;
          grid-template-columns: 60px 1fr auto;
          gap: 8px;
          font-size: 12px;
          color: #e2e8f0;
          align-items: center;
        }

        .space-commit-meta {
          color: #94a3b8;
          font-size: 11px;
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

        .changes-note {
          margin: 8px 0 0;
          color: #94a3b8;
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}
