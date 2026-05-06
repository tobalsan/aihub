/**
 * Resolve the actual `aihub` CLI invocation that subagents should use to talk
 * back to *this* gateway. Substituted into spawn prompts at render time so the
 * agent doesn't need to wrangle env vars.
 */
export function resolveAihubCli(): string {
  if (process.env.AIHUB_DEV) {
    const root = process.env.AIHUB_WORKSPACE_ROOT ?? process.cwd();
    return `pnpm --dir ${root} aihub:dev`;
  }
  return "aihub";
}

export type WorkerPromptInput = {
  sliceId: string;
  sliceTitle: string;
  projectDirPath: string;
  sliceDirPath: string;
};

export type ReviewerPromptInput = WorkerPromptInput & {
  workerWorkspaces: Array<{ name: string; cli?: string; path: string }>;
};

export type MergerPromptInput = WorkerPromptInput & {
  baseBranch: string;
  workerBranch?: string;
};

export class OrchestratorPromptFactory {
  constructor(private readonly aihubCli: string = resolveAihubCli()) {}

  buildWorkerPrompt(input: WorkerPromptInput): string {
    const signoffInstruction =
      'When posting comments via `aihub projects comment` or `aihub slices comment`, always pass `--author Worker`. Do not let comments default to "AIHub".';
    return [
      `## Working on Slice: ${input.sliceId} — ${input.sliceTitle}`,
      "",
      "## Project Context (read-only)",
      `Project folder: ${input.projectDirPath}`,
      `- [README.md](${input.projectDirPath}/README.md) — project pitch`,
      `- [SCOPE_MAP.md](${input.projectDirPath}/SCOPE_MAP.md) — sibling slice index`,
      `- [THREAD.md](${input.projectDirPath}/THREAD.md) — read for prior Reviewer feedback on this slice`,
      "",
      "## Your Slice",
      `Slice folder: ${input.sliceDirPath}`,
      `- [README.md](${input.sliceDirPath}/README.md) — must/nice requirements`,
      `- [SPECS.md](${input.sliceDirPath}/SPECS.md) — specification (check for \`## Known traps\` before changing anything)`,
      `- [TASKS.md](${input.sliceDirPath}/TASKS.md) — task checklist`,
      `- [VALIDATION.md](${input.sliceDirPath}/VALIDATION.md) — done criteria`,
      "",
      "## Your Role: Worker",
      "Implement the assigned tasks in your repository workspace.",
      "Read your slice docs to understand what must be built.",
      "Commit your implementation once checks are green.",
      "",
      "## Prior Iteration Feedback (CRITICAL)",
      "If THREAD.md shows a prior Reviewer rejection on this slice, the latest Reviewer comment is your top priority. Do NOT repeat the rejected approach.",
      "Read `## Known traps` in SPECS.md before changing anything — it captures durable inter-iteration knowledge from previous Workers.",
      "If a failing test looks unrelated to this slice, investigate root cause before band-aiding. If you believe a test is genuinely stale, comment in THREAD.md explaining why instead of editing the assertion.",
      "",
      "## Scope Constraint — Stay in Your Slice",
      `You must not modify files outside your slice directory (${input.sliceDirPath}/).`,
      "Do not modify project-level docs (README.md, SCOPE_MAP.md, THREAD.md)",
      "or other slices' files without explicit instruction.",
      "",
      "## Orchestrator Handoff",
      "Read SPECS.md, TASKS.md, and VALIDATION.md inside your slice directory.",
      "Also read THREAD.md at the project root for any prior Reviewer feedback.",
      `For any \`aihub\` CLI calls, invoke \`${this.aihubCli}\` (this targets the gateway that owns this project - prod or dev).`,
      signoffInstruction,
      `When all VALIDATION.md criteria pass, run \`${this.aihubCli} slices move ${input.sliceId} review\` and exit.`,
    ]
      .join("\n")
      .trim();
  }

  buildReviewerPrompt(input: ReviewerPromptInput): string {
    const signoffInstruction =
      'When posting comments via `aihub projects comment` or `aihub slices comment`, always pass `--author Reviewer`. Do not let comments default to "AIHub".';
    const workspacesBlock =
      input.workerWorkspaces.length > 0
        ? [
            "## Active Worker Workspaces",
            ...input.workerWorkspaces.map(
              (item) => `- ${item.name} (${item.cli || "agent"}): ${item.path}`
            ),
          ].join("\n")
        : "## Active Worker Workspaces\nNo active worker workspaces found.";

    return [
      `## Reviewing Slice: ${input.sliceId} — ${input.sliceTitle}`,
      "",
      "## Project Context (read-only)",
      `Project folder: ${input.projectDirPath}`,
      `- [README.md](${input.projectDirPath}/README.md)`,
      `- [SCOPE_MAP.md](${input.projectDirPath}/SCOPE_MAP.md)`,
      "",
      "## Slice Docs",
      `Slice folder: ${input.sliceDirPath}`,
      `- [README.md](${input.sliceDirPath}/README.md)`,
      `- [SPECS.md](${input.sliceDirPath}/SPECS.md)`,
      `- [TASKS.md](${input.sliceDirPath}/TASKS.md)`,
      `- [VALIDATION.md](${input.sliceDirPath}/VALIDATION.md)`,
      "",
      workspacesBlock,
      "",
      "## Your Role: Reviewer",
      "Review the worker's implementation against SPECS.md / TASKS.md / VALIDATION.md.",
      "Worker workspaces are listed above; inspect their diffs and run their tests as needed.",
      `For any \`aihub\` CLI calls, invoke \`${this.aihubCli}\` (this targets the gateway that owns this project - prod or dev).`,
      signoffInstruction,
      "",
      "Decision protocol:",
      `- If ALL VALIDATION.md criteria pass: run \`${this.aihubCli} slices comment ${input.sliceId} --author Reviewer "<one-line PASS summary>"\` then \`${this.aihubCli} slices move ${input.sliceId} ready_to_merge\`. Exit.`,
      `- If ANY criterion fails or the diff has blocking issues:`,
      `    1. Run \`${this.aihubCli} slices comment ${input.sliceId} --author Reviewer "<crisp list of gaps, file:line where applicable>"\` (this records to THREAD.md).`,
      `    2. Append/update a \`## Known traps\` section in ${input.sliceDirPath}/SPECS.md so the next Worker reads it. For each new trap, capture three fields:`,
      `       - **Symptom** — failing test name, error, file:line.`,
      `       - **Wrong fix to avoid** — what previous Worker(s) tried that you rejected.`,
      `       - **Correct fix / investigation direction** — what the next Worker should do instead.`,
      `       Keep entries terse. If a matching trap already exists, update it rather than duplicating.`,
      `    3. Run \`${this.aihubCli} slices move ${input.sliceId} todo\`. Exit.`,
      "",
      "Do NOT move to `done` - that's a manual merge gate. Do NOT push, do NOT merge.",
    ]
      .join("\n")
      .trim();
  }

  buildMergerPrompt(input: MergerPromptInput): string {
    const mergeTarget = input.workerBranch ?? "<slice-worker-branch>";
    const signoffInstruction =
      'When posting comments via `aihub slices comment`, always pass `--author Merger`. Do not let comments default to "AIHub".';

    return [
      `## Merging Slice: ${input.sliceId} — ${input.sliceTitle}`,
      "",
      "## Project Context",
      `Project folder: ${input.projectDirPath}`,
      `Slice folder: ${input.sliceDirPath}`,
      `Integration branch: ${input.baseBranch}`,
      `Slice branch: ${mergeTarget}`,
      "",
      "## Your Role: Merger",
      "You are running in a worktree forked from the project integration branch.",
      `Run \`git merge ${mergeTarget}\` to merge the slice branch into this integration branch worktree.`,
      "If the merge is clean, commit if needed, then run targeted validation you can discover plus `pnpm typecheck` when available.",
      "If conflicts are trivial, resolve them, commit, and run validation.",
      `On success: run \`${this.aihubCli} slices comment ${input.sliceId} --author Merger "Merged to integration."\` then \`${this.aihubCli} slices move ${input.sliceId} done\`. Exit.`,
      `On irrecoverable conflict or validation failure: run \`${this.aihubCli} slices merger-conflict ${input.sliceId} "<files or failing checks>"\`, then run \`${this.aihubCli} slices comment ${input.sliceId} --author Merger "Merge conflict — needs human: <files or failing checks>"\`. Leave the slice in \`ready_to_merge\` and exit.`,
      "Do not push. Do not merge integration into main.",
      signoffInstruction,
    ]
      .join("\n")
      .trim();
  }
}
