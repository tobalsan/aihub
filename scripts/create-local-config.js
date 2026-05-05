#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

const UI_PORT_RANGE = {
  start: 3001,
  end: 3100,
};
const GATEWAY_PORT_RANGE = {
  start: 4001,
  end: 4100,
};
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const templatePath = path.join(scriptDir, "config-template.json");
const agentsSourceDir = path.join(scriptDir, "agents");
const outputDir = path.join(repoRoot, ".aihub");
const outputPath = path.join(outputDir, "aihub.json");
const agentsOutputDir = path.join(outputDir, "agents");
const projectsOutputDir = path.join(outputDir, "projects");

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port);
  });
}

async function findAvailablePort(range) {
  const ports = [];
  for (let port = range.start; port <= range.end; port += 1) {
    ports.push(port);
  }

  const results = await Promise.all(ports.map((port) => checkPort(port)));
  const index = results.findIndex(Boolean);

  if (index === -1) {
    throw new Error(
      `No available port found between ${range.start} and ${range.end}.`,
    );
  }

  return ports[index];
}

const dummyProjects = [
  {
    id: "PRO-001",
    folder: "PRO-001_demo_board_polish",
    title: "Demo board polish",
    area: "Demo",
    status: "shaping",
    created: "2026-04-28T09:00:00.000Z",
    updated: "2026-05-02T16:42:11.000Z",
    summary:
      "Sample project to preview the lifecycle-grouped board, project detail tabs, and slice kanban with realistic data.",
    body: [
      "Polish pass for the Board UI. Three small slices that each touch a distinct surface so the demo data exercises the most common views (project list, detail tabs, slice kanban).",
      "",
      "## Goals",
      "",
      "- Make the lifecycle-grouped project list legible at a glance.",
      "- Avoid full-page reflows when switching between project detail tabs.",
      "- Improve the empty state so a brand-new install looks intentional, not broken.",
    ].join("\n"),
    slices: [
      {
        num: 1,
        title: "Group projects by lifecycle in the board list",
        status: "done",
        hill: "done",
        body: "Group the project list by `status` buckets (Shaping / Active / Done / Cancelled). Collapsed by default for Cancelled.",
      },
      {
        num: 2,
        title: "Tab-local Suspense boundaries on project detail",
        status: "in_progress",
        hill: "executing",
        body: "Wrap each tab panel in its own `<Suspense>` so resource reads inside Slices don't bubble up and re-suspend the chat panel.",
      },
      {
        num: 3,
        title: "Empty-state polish for fresh installs",
        status: "todo",
        hill: "figuring",
        body: "When no projects exist, replace the blank pane with a short blurb + 'Create project' CTA. Same treatment for the slice kanban.",
      },
    ],
    sessions: [
      {
        sliceNum: 2,
        slug: "pro-001-s02-demo01",
        outcome: "running",
        startedAt: "2026-05-02T15:10:04.122Z",
        finishedAt: null,
      },
    ],
    queue: [
      {
        sliceNum: 2,
        slug: "pro-001-s02-demo01",
        status: "pending",
        createdAt: "2026-05-02T15:10:04.000Z",
      },
    ],
  },
  {
    id: "PRO-002",
    folder: "PRO-002_onboarding_tour",
    title: "Onboarding tour",
    area: "Demo",
    status: "done",
    created: "2026-04-15T08:00:00.000Z",
    updated: "2026-04-22T11:08:30.000Z",
    summary:
      "Two-slice mini project, fully merged. Useful for previewing the 'done' lifecycle bucket and read-only views.",
    body: [
      "Walks new users through aihub on first launch: sidebar tour, project creation, slice kanban.",
      "",
      "Shipped 2026-04-22. Kept around as a sample of a finished project so demo screenshots still have something to render in the Done bucket.",
    ].join("\n"),
    slices: [
      {
        num: 1,
        title: "Tour scaffold and step navigator",
        status: "done",
        hill: "done",
        body: "Skeleton component + step state machine. No content yet; copy lands in S02.",
      },
      {
        num: 2,
        title: "Persist tour-completed flag in user settings",
        status: "done",
        hill: "done",
        body: "Write `onboarding.tourCompletedAt` once the user finishes or skips the last step. Idempotent.",
      },
    ],
    sessions: [
      {
        sliceNum: 1,
        slug: "pro-002-s01-demo01",
        outcome: "done",
        startedAt: "2026-04-16T09:02:13.000Z",
        finishedAt: "2026-04-16T09:18:47.000Z",
      },
      {
        sliceNum: 2,
        slug: "pro-002-s02-demo01",
        outcome: "done",
        startedAt: "2026-04-21T14:30:00.000Z",
        finishedAt: "2026-04-21T14:55:21.000Z",
      },
    ],
    queue: [],
  },
  {
    id: "PRO-003",
    folder: "PRO-003_sample_repo_integration",
    title: "Sample repo integration",
    area: "Demo",
    status: "active",
    repo: "/Users/thinh/code/aihub",
    created: "2026-05-01T09:00:00.000Z",
    updated: "2026-05-04T12:14:55.000Z",
    summary:
      "Larger demo project with four slices and a session queue — exercises worker dispatch, the merger flow, and stall detection in the kanban.",
    body: [
      "Wires aihub against a sample repo end-to-end so demo flows have something to dispatch against. Mirrors the structure of a real integration project (PRO-242) at a smaller scale.",
      "",
      "## Clusters",
      "",
      "- **Branching.** S01 sets up the per-project integration branch. S02 reroutes worker dispatch to fork off it instead of `main`.",
      "- **Merging.** S03 introduces a Merger agent profile so `ready_to_merge` slices flow back into the integration branch automatically.",
      "- **Robustness.** S04 wires stall detection into the orchestrator tick.",
    ].join("\n"),
    slices: [
      {
        num: 1,
        title: "Project integration branch lifecycle",
        status: "done",
        hill: "done",
        body: "Lazy create `<projectId>/integration` off `main` on first worker dispatch. Idempotent helper, local-only branch.",
      },
      {
        num: 2,
        title: "Worker dispatch forks off integration branch",
        status: "review",
        hill: "executing",
        body: "Replace the hardcoded `main` base for orchestrator-spawned workers with the per-project integration branch from S01.",
      },
      {
        num: 3,
        title: "Merger agent profile + tick step",
        status: "in_progress",
        hill: "executing",
        body: "Spawn a Merger when a slice hits `ready_to_merge`. Merge slice branch → integration; on conflict, escalate to HITL.",
      },
      {
        num: 4,
        title: "Stall detection for long-idle slices",
        status: "todo",
        hill: "figuring",
        body: "Flag `in_progress` / `review` slices with no live subagent after N minutes. Surface a badge in the kanban.",
      },
    ],
    sessions: [
      {
        sliceNum: 2,
        slug: "pro-003-s02-demo01",
        outcome: "done",
        startedAt: "2026-05-03T10:14:00.000Z",
        finishedAt: "2026-05-03T10:33:42.000Z",
      },
      {
        sliceNum: 3,
        slug: "pro-003-s03-demo02",
        outcome: "running",
        startedAt: "2026-05-04T11:50:21.000Z",
        finishedAt: null,
      },
    ],
    queue: [
      {
        sliceNum: 2,
        slug: "pro-003-s02-demo01",
        status: "pending",
        createdAt: "2026-05-03T10:14:00.000Z",
      },
      {
        sliceNum: 3,
        slug: "pro-003-s03-demo02",
        status: "pending",
        createdAt: "2026-05-04T11:50:21.000Z",
      },
    ],
  },
];

function sliceId(projectId, num) {
  return `${projectId}-S${String(num).padStart(2, "0")}`;
}

function projectReadme(project) {
  const fm = [
    `id: "${project.id}"`,
    `title: "${project.title}"`,
    `status: "${project.status}"`,
    `created: "${project.created}"`,
    `area: "${project.area}"`,
  ];
  if (project.repo) fm.push(`repo: "${project.repo}"`);
  return `---\n${fm.join("\n")}\n---\n# ${project.title}\n\n${project.summary}\n\n${project.body}\n`;
}

function scopeMap(project) {
  const lines = [
    "<!-- Auto-generated by aihub. Do not edit by hand. -->",
    `# Scope map — ${project.id}`,
    "",
    "| Slice | Title | Status | Hill |",
    "|-------|-------|--------|------|",
  ];
  for (const slice of project.slices) {
    lines.push(
      `| ${sliceId(project.id, slice.num)} | ${slice.title} | ${slice.status} | ${slice.hill} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function threadFile(project) {
  return `---\nproject: ${project.id}\n---\n`;
}

function sliceReadme(project, slice) {
  const id = sliceId(project.id, slice.num);
  return `---\nid: "${id}"\nproject_id: "${project.id}"\ntitle: "${slice.title}"\nstatus: "${slice.status}"\nhill_position: "${slice.hill}"\ncreated_at: "${project.created}"\nupdated_at: "${project.updated}"\n---\n# ${slice.title}\n\n${slice.body}\n`;
}

function counters(project) {
  return `${JSON.stringify({ lastSliceId: project.slices.length }, null, 2)}\n`;
}

function spaceFile(project) {
  const queue = project.queue.map((entry) => ({
    id: `${entry.slug}:${new Date(entry.createdAt).getTime()}`,
    workerSlug: entry.slug,
    runMode: "worktree",
    worktreePath: `/tmp/aihub-demo/${project.id}/${entry.slug}`,
    startSha: "0000000000000000000000000000000000000000",
    endSha: "0000000000000000000000000000000000000000",
    shas: [],
    status: entry.status,
    createdAt: entry.createdAt,
  }));
  return `${JSON.stringify(
    {
      version: 1,
      projectId: project.id,
      branch: `space/${project.id}`,
      worktreePath: `/tmp/aihub-demo/.workspaces/${project.id}/_space`,
      baseBranch: "main",
      integrationBlocked: false,
      queue,
      updatedAt: project.updated,
    },
    null,
    2,
  )}\n`;
}

function sessionConfig(project, session) {
  return `${JSON.stringify(
    {
      name: "Worker",
      cli: "codex",
      projectId: project.id,
      sliceId: sliceId(project.id, session.sliceNum),
      model: "gpt-5.5",
      reasoningEffort: "medium",
      runMode: "worktree",
      baseBranch: "main",
      source: "orchestrator",
      created: session.startedAt,
      archived: false,
    },
    null,
    2,
  )}\n`;
}

function sessionState(project, session) {
  const sId = sliceId(project.id, session.sliceNum);
  return `${JSON.stringify(
    {
      session_id: `demo-${session.slug}`,
      project_id: project.id,
      slice_id: sId,
      supervisor_pid: 0,
      started_at: session.startedAt,
      last_error: "",
      cli: "codex",
      run_mode: "worktree",
      worktree_path: `/tmp/aihub-demo/${project.id}/${session.slug}`,
      base_branch: "main",
      start_head_sha: "0000000000000000000000000000000000000000",
      end_head_sha: "0000000000000000000000000000000000000000",
      commit_range: "",
      finished_at: session.finishedAt ?? "",
      outcome: session.outcome,
    },
    null,
    2,
  )}\n`;
}

function sessionProgress(session) {
  return `${JSON.stringify(
    {
      last_active: session.finishedAt ?? session.startedAt,
      tool_calls: 0,
    },
    null,
    2,
  )}\n`;
}

function sessionHistory(session) {
  const lines = [
    JSON.stringify({
      ts: session.startedAt,
      type: "worker.started",
      data: { action: "started", harness: "codex", session_id: "" },
    }),
  ];
  if (session.finishedAt) {
    lines.push(
      JSON.stringify({
        ts: session.finishedAt,
        type: "worker.finished",
        data: {
          run_id: `demo-${session.slug}`,
          duration_ms: 0,
          tool_calls: 0,
          outcome: "replied",
        },
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

function sessionLogs(project, session) {
  const sId = sliceId(project.id, session.sliceNum);
  return `${JSON.stringify({
    type: "event_msg",
    payload: {
      type: "user_message",
      message: `## Working on Slice: ${sId}\n\nDemo session — no real run.`,
    },
  })}\n`;
}

async function writeDummyProject(project) {
  const projectDir = path.join(projectsOutputDir, project.folder);
  await mkdir(path.join(projectDir, ".meta"), { recursive: true });
  await mkdir(path.join(projectDir, "slices"), { recursive: true });
  await mkdir(path.join(projectDir, "sessions"), { recursive: true });

  await Promise.all([
    writeFile(path.join(projectDir, "README.md"), projectReadme(project)),
    writeFile(path.join(projectDir, "SCOPE_MAP.md"), scopeMap(project)),
    writeFile(path.join(projectDir, "THREAD.md"), threadFile(project)),
    writeFile(path.join(projectDir, "space.json"), spaceFile(project)),
    writeFile(path.join(projectDir, ".meta", "counters.json"), counters(project)),
    ...project.slices.map(async (slice) => {
      const sliceDir = path.join(
        projectDir,
        "slices",
        sliceId(project.id, slice.num),
      );
      await mkdir(sliceDir, { recursive: true });
      await writeFile(
        path.join(sliceDir, "README.md"),
        sliceReadme(project, slice),
      );
    }),
    ...project.sessions.map(async (session) => {
      const sessionDir = path.join(projectDir, "sessions", session.slug);
      await mkdir(sessionDir, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(sessionDir, "config.json"),
          sessionConfig(project, session),
        ),
        writeFile(
          path.join(sessionDir, "state.json"),
          sessionState(project, session),
        ),
        writeFile(
          path.join(sessionDir, "progress.json"),
          sessionProgress(session),
        ),
        writeFile(
          path.join(sessionDir, "history.jsonl"),
          sessionHistory(session),
        ),
        writeFile(
          path.join(sessionDir, "logs.jsonl"),
          sessionLogs(project, session),
        ),
      ]);
    }),
  ]);
}

async function seedDummyProjects() {
  await mkdir(projectsOutputDir, { recursive: true });
  await Promise.all(dummyProjects.map(writeDummyProject));
}

async function main() {
  const [template, gatewayPort, uiPort] = await Promise.all([
    readFile(templatePath, "utf8"),
    findAvailablePort(GATEWAY_PORT_RANGE),
    findAvailablePort(UI_PORT_RANGE),
  ]);
  const projectsRoot = path.join(repoRoot, ".aihub", "projects");
  const content = template
    .replaceAll("__GATEWAY_PORT__", String(gatewayPort))
    .replaceAll("__UI_PORT__", String(uiPort))
    .replaceAll("__PROJECTS_ROOT__", JSON.stringify(projectsRoot));

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content);
  await cp(agentsSourceDir, agentsOutputDir, { recursive: true });
  await seedDummyProjects();

  stdout.write(
    `Wrote ${path.relative(repoRoot, outputPath)} with gateway ${gatewayPort} and ui ${uiPort}\n`,
  );
  stdout.write(
    `Copied agents to ${path.relative(repoRoot, agentsOutputDir)}\n`,
  );
  stdout.write(
    `Seeded ${dummyProjects.length} demo projects in ${path.relative(repoRoot, projectsOutputDir)}\n`,
  );
}

await main();
