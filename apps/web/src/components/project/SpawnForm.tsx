import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { buildRolePrompt, type PromptRole } from "@aihub/shared";
import { spawnSubagent } from "../../api/client";
import type { ProjectDetail, SubagentListItem } from "../../api/types";

export type SpawnTemplate = "coordinator" | "worker" | "reviewer" | "custom";

export type SpawnPrefill = {
  name?: string;
  cli?: "codex" | "claude" | "pi";
  model?: string;
  reasoning?: string;
  runMode?: "clone" | "main" | "worktree" | "none";
  customInstructions?: string;
  includeDefaultPrompt?: boolean;
  includePostRun?: boolean;
};

export type SpawnFormProps = {
  projectId: string;
  project: ProjectDetail;
  prefill: SpawnPrefill;
  template: SpawnTemplate;
  subagents: SubagentListItem[];
  onSpawned: (slug: string) => void;
  onCancel: () => void;
};

const HARNESS_MODELS = {
  codex: ["gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"],
  claude: ["opus", "sonnet", "haiku"],
  pi: [
    "qwen3.5-plus",
    "qwen3-max-2026-01-23",
    "MiniMax-M2.5",
    "glm-5",
    "kimi-k2.5",
  ],
} as const;

const HARNESS_REASONING = {
  codex: ["xhigh", "high", "medium", "low"],
  claude: ["high", "medium", "low"],
  pi: ["off", "low", "medium", "high", "xhigh"],
} as const;

function createSlug(cli: string): string {
  return `${cli}-${Date.now().toString(36).slice(-6)}`;
}

function normalizeDocFilename(key: string): string {
  return key.toLowerCase().endsWith(".md") ? key : `${key}.md`;
}

function getFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string
): string {
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

function mapTemplateToPromptRole(template: SpawnTemplate): PromptRole {
  if (template === "coordinator") return "coordinator";
  if (template === "worker") return "worker";
  if (template === "reviewer") return "reviewer";
  return "legacy";
}

function parseReviewerWorkspaces(list: string) {
  return list
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const parsed = /^- (.+?) \((.+?)\): (.+)$/.exec(line);
      if (!parsed) return null;
      return { name: parsed[1], cli: parsed[2], path: parsed[3] };
    })
    .filter((item): item is { name: string; cli: string; path: string } =>
      Boolean(item)
    );
}

export function buildReviewerWorkspaceList(
  projectId: string,
  subagents: SubagentListItem[]
): string {
  const workers = subagents.filter(
    (item) =>
      item.runMode !== "none" &&
      item.runMode !== "main-run" &&
      (item.status === "running" || item.status === "replied")
  );
  if (workers.length === 0) return "No active worker workspaces found.";
  return workers
    .map(
      (item) =>
        `- ${item.name || item.slug} (${item.cli || "agent"}): ~/projects/.workspaces/${projectId}/${item.slug}/`
    )
    .join("\n");
}

export function SpawnForm(props: SpawnFormProps) {
  const [addAgentCli, setAddAgentCli] = createSignal<"codex" | "claude" | "pi">(
    "codex"
  );
  const [addAgentName, setAddAgentName] = createSignal("");
  const [addAgentModel, setAddAgentModel] = createSignal("gpt-5.3-codex");
  const [addAgentReasoning, setAddAgentReasoning] = createSignal("high");
  const [addAgentRunMode, setAddAgentRunMode] = createSignal<
    "clone" | "main" | "worktree" | "none"
  >("clone");
  const [includeDefaultPrompt, setIncludeDefaultPrompt] = createSignal(true);
  const [includePostRun, setIncludePostRun] = createSignal(true);
  const [addAgentCustomInstructions, setAddAgentCustomInstructions] =
    createSignal("");
  const [addingAgent, setAddingAgent] = createSignal(false);
  const [agentError, setAgentError] = createSignal<string | null>(null);

  createEffect(() => {
    const prefill = props.prefill;
    const nextCli = prefill.cli ?? "codex";
    setAddAgentCli(nextCli);
    setAddAgentName(prefill.name ?? "");
    setAddAgentModel(prefill.model ?? HARNESS_MODELS[nextCli][0]);
    setAddAgentReasoning(prefill.reasoning ?? HARNESS_REASONING[nextCli][0]);
    setAddAgentRunMode(prefill.runMode ?? "clone");
    setIncludeDefaultPrompt(prefill.includeDefaultPrompt ?? true);
    setIncludePostRun(prefill.includePostRun ?? true);
    setAddAgentCustomInstructions(prefill.customInstructions ?? "");
    setAgentError(null);
  });

  createEffect(() => {
    const cli = addAgentCli();
    const models = HARNESS_MODELS[cli];
    if (!models.some((model) => model === addAgentModel())) {
      setAddAgentModel(models[0]);
    }
    const efforts = HARNESS_REASONING[cli];
    if (!efforts.some((effort) => effort === addAgentReasoning())) {
      setAddAgentReasoning(efforts[0]);
    }
  });

  const reviewerWorkspaceList = createMemo(() =>
    buildReviewerWorkspaceList(props.projectId, props.subagents)
  );
  const effectiveProjectPath = createMemo(
    () => props.project.absolutePath || props.project.path
  );
  const projectFiles = createMemo(() => {
    const files = new Set<string>(["README.md", "THREAD.md"]);
    for (const key of Object.keys(props.project.docs ?? {})) {
      files.add(normalizeDocFilename(key));
    }
    return Array.from(files);
  });

  const preparedPrompt = createMemo(() => {
    const status =
      getFrontmatterString(props.project.frontmatter, "status") || "unknown";
    const owner = getFrontmatterString(props.project.frontmatter, "owner");
    const repoPath = getFrontmatterString(props.project.frontmatter, "repo").trim();
    const cli = addAgentCli();
    const author =
      addAgentName().trim() ||
      (cli === "codex" ? "Codex" : cli === "claude" ? "Claude" : "Pi");
    const promptRole = mapTemplateToPromptRole(props.template);
    return buildRolePrompt({
      role: promptRole,
      title: `${props.project.id} — ${props.project.title}`,
      status,
      path: effectiveProjectPath(),
      projectId: props.projectId,
      repo: repoPath,
      runAgentLabel: author,
      owner,
      customPrompt: addAgentCustomInstructions().trim(),
      includeDefaultPrompt: includeDefaultPrompt(),
      includePostRun: includePostRun(),
      projectFiles: projectFiles(),
      workerWorkspaces: parseReviewerWorkspaces(reviewerWorkspaceList()),
      specsPath: `${effectiveProjectPath().replace(/\/$/, "")}/README.md`,
      content: Object.values(props.project.docs ?? {}).join("\n\n"),
    });
  });

  const canSpawnPreparedAgent = createMemo(
    () => preparedPrompt().trim().length > 0 && !addingAgent()
  );

  const resolvedMode = createMemo<"clone" | "main-run" | "worktree" | "none">(
    () =>
      addAgentRunMode() === "main"
        ? "main-run"
        : addAgentRunMode() === "worktree"
          ? "worktree"
          : addAgentRunMode() === "none"
            ? "none"
            : "clone"
  );

  const cliPreview = createMemo(() => {
    const cli = addAgentCli();
    if (cli === "codex") {
      return `codex exec --json --dangerously-bypass-approvals-and-sandbox -m ${addAgentModel()} -c reasoning_effort=${addAgentReasoning()}`;
    }
    if (cli === "claude") {
      return `claude -p "<prompt>" --output-format stream-json --verbose --dangerously-skip-permissions --model ${addAgentModel()} --effort ${addAgentReasoning()}`;
    }
    return `pi --mode json --session <session_file> --model ${addAgentModel()} --thinking ${addAgentReasoning()} "<prompt>"`;
  });

  const submitAddAgent = async () => {
    if (!canSpawnPreparedAgent()) return;
    setAddingAgent(true);
    setAgentError(null);

    const prompt = preparedPrompt();
    const promptRole = mapTemplateToPromptRole(props.template);
    const result = await spawnSubagent(props.projectId, {
      slug: createSlug(addAgentCli()),
      cli: addAgentCli(),
      name: addAgentName().trim() || undefined,
      prompt,
      template: props.template,
      promptRole,
      includeDefaultPrompt: includeDefaultPrompt(),
      includePostRun: includePostRun(),
      model: addAgentModel(),
      reasoningEffort: addAgentCli() === "pi" ? undefined : addAgentReasoning(),
      thinking: addAgentCli() === "pi" ? addAgentReasoning() : undefined,
      mode: resolvedMode(),
    });
    setAddingAgent(false);

    if (!result.ok) {
      setAgentError(result.error);
      return;
    }

    props.onSpawned(result.data.slug);
  };

  return (
    <section class="spawn-form-panel">
      <div class="spawn-form-header">
        <h3>Spawn Agent</h3>
        <p>
          Template: <strong>{props.template}</strong>
        </p>
      </div>
      <form
        class="add-agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitAddAgent();
        }}
      >
        <label class="add-agent-label">
          Agent name (optional)
          <input
            class="add-agent-input"
            type="text"
            value={addAgentName()}
            onInput={(event) => setAddAgentName(event.currentTarget.value)}
            placeholder="Defaults to current naming"
          />
        </label>
        <label class="add-agent-label">
          Harness
          <select
            class="add-agent-select"
            value={addAgentCli()}
            onChange={(event) =>
              setAddAgentCli(
                event.currentTarget.value as "codex" | "claude" | "pi"
              )
            }
          >
            <option value="codex">codex</option>
            <option value="claude">claude</option>
            <option value="pi">pi</option>
          </select>
        </label>
        <label class="add-agent-label">
          Model
          <select
            class="add-agent-select"
            value={addAgentModel()}
            onChange={(event) => setAddAgentModel(event.currentTarget.value)}
          >
            <For each={HARNESS_MODELS[addAgentCli()]}>
              {(model) => <option value={model}>{model}</option>}
            </For>
          </select>
        </label>
        <label class="add-agent-label">
          <Show
            when={addAgentCli() === "pi"}
            fallback={addAgentCli() === "claude" ? "Effort" : "Reasoning"}
          >
            Thinking
          </Show>
          <select
            class="add-agent-select"
            value={addAgentReasoning()}
            onChange={(event) =>
              setAddAgentReasoning(event.currentTarget.value)
            }
          >
            <For each={HARNESS_REASONING[addAgentCli()]}>
              {(value) => <option value={value}>{value}</option>}
            </For>
          </select>
        </label>
        <label class="add-agent-label">
          Run mode
          <select
            class="add-agent-select"
            value={addAgentRunMode()}
            onChange={(event) =>
              setAddAgentRunMode(
                event.currentTarget.value as
                  | "clone"
                  | "main"
                  | "worktree"
                  | "none"
              )
            }
          >
            <option value="clone">clone</option>
            <option value="main">main</option>
            <option value="worktree">worktree</option>
            <option value="none">none</option>
          </select>
        </label>
        <div class="add-agent-checklist">
          <label class="add-agent-check">
            <input
              type="checkbox"
              checked={includeDefaultPrompt()}
              onInput={(event) =>
                setIncludeDefaultPrompt(event.currentTarget.checked)
              }
            />
            Default AI prompt
          </label>
          <label class="add-agent-check">
            <input
              type="checkbox"
              checked={includePostRun()}
              onInput={(event) =>
                setIncludePostRun(event.currentTarget.checked)
              }
            />
            AIHub post-run instructions
          </label>
        </div>
        <label class="add-agent-label">
          Custom instructions (appended last)
          <textarea
            class="add-agent-prompt"
            value={addAgentCustomInstructions()}
            onInput={(event) =>
              setAddAgentCustomInstructions(event.currentTarget.value)
            }
            placeholder="Optional custom instructions"
          />
        </label>
        <details class="add-agent-preview">
          <summary>Final prompt preview</summary>
          <pre>{preparedPrompt() || "(empty)"}</pre>
        </details>
        <div class="add-agent-cli-preview">{cliPreview()}</div>
        <div class="add-agent-actions">
          <button
            type="button"
            class="add-agent-cancel"
            onClick={props.onCancel}
            disabled={addingAgent()}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="add-agent-submit"
            disabled={!canSpawnPreparedAgent()}
          >
            {addingAgent() ? "Spawning..." : "Spawn"}
          </button>
        </div>
      </form>
      <Show when={agentError()}>
        {(message) => <p class="agent-error">{message()}</p>}
      </Show>
      <style>{`
        .spawn-form-panel {
          padding: 18px;
          display: grid;
          gap: 10px;
          min-height: 100%;
          background: #0a0a0f;
          color: #e4e4e7;
        }

        .spawn-form-header h3 {
          margin: 0;
          font-size: 14px;
        }

        .spawn-form-header p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #94a3b8;
        }

        .add-agent-form {
          margin-top: 8px;
          display: grid;
          gap: 8px;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 8px;
          background: #0f1724;
        }

        .add-agent-label {
          display: grid;
          gap: 4px;
          color: #94a3b8;
          font-size: 11px;
        }

        .add-agent-select,
        .add-agent-input,
        .add-agent-prompt {
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #0b1220;
          color: #e4e4e7;
          font: inherit;
          font-size: 12px;
          padding: 6px 8px;
        }

        .add-agent-prompt {
          min-height: 74px;
          resize: vertical;
        }

        .add-agent-checklist {
          display: grid;
          gap: 4px;
        }

        .add-agent-check {
          display: flex;
          gap: 6px;
          align-items: center;
          color: #cbd5e1;
          font-size: 12px;
        }

        .add-agent-preview {
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #0b1220;
          padding: 6px 8px;
        }

        .add-agent-preview summary {
          cursor: pointer;
          font-size: 11px;
          color: #93c5fd;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .add-agent-preview pre {
          margin: 8px 0 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: 11px;
          line-height: 1.45;
          color: #dbeafe;
        }

        .add-agent-cli-preview {
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #0b1220;
          color: #cbd5e1;
          font-size: 11px;
          line-height: 1.4;
          padding: 6px 8px;
          overflow-wrap: anywhere;
        }

        .add-agent-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }

        .add-agent-cancel,
        .add-agent-submit {
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #111722;
          color: #e4e4e7;
          font-size: 12px;
          padding: 5px 10px;
          cursor: pointer;
        }

        .add-agent-submit {
          border-color: #3b82f6;
          background: #1d4ed8;
          color: #fff;
        }

        .agent-error {
          margin: 8px 0 0;
          font-size: 11px;
          color: #fca5a5;
        }
      `}</style>
    </section>
  );
}
