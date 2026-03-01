import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
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

const PREPARE_DEFAULT_PROMPT =
  "Review the full project context and implement the next highest-impact step.";
const PREPARE_POST_RUN_INSTRUCTIONS = [
  "When done, run relevant tests.",
  "Post a concise update with what changed and what remains.",
  "If implementation is complete, move the project to review.",
].join("\n");

const COORDINATOR_ROLE_INSTRUCTIONS = [
  "## Your Role: Coordinator",
  "You manage this project's execution. You do NOT implement code yourself.",
  "- Review the spec and break it into discrete tasks if not already done",
  "- Monitor worker agents and their progress",
  "- Update SPECS.md task statuses as work progresses",
  "- When all tasks are done, verify acceptance criteria",
].join("\n");

const REVIEWER_ROLE_INSTRUCTIONS = [
  "## Your Role: Reviewer",
  "Review the implementation done by worker agents. For each worker workspace:",
  "- Read the changes (git diff)",
  "- Run the test suite",
  "- Check code quality and adherence to specs",
  "- Report findings and flag any issues",
].join("\n");

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
    if (!models.includes(addAgentModel() as (typeof models)[number])) {
      setAddAgentModel(models[0]);
    }
    const efforts = HARNESS_REASONING[cli];
    if (!efforts.includes(addAgentReasoning() as (typeof efforts)[number])) {
      setAddAgentReasoning(efforts[0]);
    }
  });

  const reviewerWorkspaceList = createMemo(() =>
    buildReviewerWorkspaceList(props.projectId, props.subagents)
  );

  const templatePromptAdditions = createMemo(() => {
    if (props.template === "coordinator") {
      return COORDINATOR_ROLE_INSTRUCTIONS;
    }
    if (props.template === "reviewer") {
      return `${REVIEWER_ROLE_INSTRUCTIONS}\n\n## Active Worker Workspaces\n${reviewerWorkspaceList()}`;
    }
    return "";
  });

  const preparedPrompt = createMemo(() => {
    const parts: string[] = [];
    if (includeDefaultPrompt()) parts.push(PREPARE_DEFAULT_PROMPT);
    if (includePostRun()) parts.push(PREPARE_POST_RUN_INSTRUCTIONS);
    const custom = addAgentCustomInstructions().trim();
    if (custom) parts.push(custom);
    const templateInstructions = templatePromptAdditions().trim();
    if (templateInstructions) parts.push(templateInstructions);
    return parts.join("\n\n");
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
    const result = await spawnSubagent(props.projectId, {
      slug: createSlug(addAgentCli()),
      cli: addAgentCli(),
      name: addAgentName().trim() || undefined,
      prompt,
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
