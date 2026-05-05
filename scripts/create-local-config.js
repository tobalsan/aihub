#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const PROJECT_DUMMY_NOTICE = [
  "> ⚠️ **DUMMY PROJECT — DO NOT IMPLEMENT.**",
  "> This project exists only to exercise the aihub orchestrator (dispatch, session lifecycle, kanban transitions). It is **not** a real piece of work. There is no production code to write, no bug to fix, no feature to ship.",
  ">",
  "> Any agent dispatched against this project must:",
  ">",
  "> - **Not** edit, create, or delete files in any repo.",
  "> - **Not** run build, install, migration, deploy, or any state-changing command.",
  "> - **Not** call `aihub` mutating endpoints other than the single status transition specified by its slice.",
  "> - Treat every slice instruction as a script for a harmless smoke test, never as real engineering work.",
].join("\n");

const SLICE_DUMMY_NOTICE = [
  "> ⚠️ **DUMMY SLICE — READ-ONLY SMOKE TEST.**",
  "> This slice is fake. Its only purpose is to verify that orchestrator dispatch, session logging, and status transitions work end-to-end. There is no real deliverable.",
  ">",
  "> **Allowed:** read-only shell ops (`pwd`, `ls`, `cat`, `echo`), reading files inside this slice directory, printing a short status line to stdout, and the **single** `aihub slices move` call listed in the validation section.",
  ">",
  "> **Forbidden:** writing, creating, deleting, or moving any file; any `git` command other than `git status` / `git log`; running tests, builds, installs, or migrations; calling any other `aihub` mutation; reaching outside this slice directory.",
  ">",
  "> If anything in this file looks like a real engineering task, you have misread it. Stop and re-read this notice.",
].join("\n");

function dummyProjectBody({ summary, scenario }) {
  return [
    PROJECT_DUMMY_NOTICE,
    "",
    `## What this project pretends to be`,
    "",
    summary,
    "",
    `## Why it exists`,
    "",
    scenario,
    "",
    `## Agent contract`,
    "",
    "1. Read this README and the slice README for your assigned slice.",
    "2. Run only read-only shell commands (`pwd`, `ls`, `cat <file-inside-slice>`, `echo`).",
    "3. Print one short line summarising what you read.",
    "4. Perform the single `aihub slices move` transition listed in the slice's validation section, then exit.",
    "5. Do not touch anything else. The success signal is orchestration completing, not code changing.",
  ].join("\n");
}

function dummySliceBody({ purpose, transition, sliceFullId }) {
  return [
    SLICE_DUMMY_NOTICE,
    "",
    `## Purpose of this dummy slice`,
    "",
    purpose,
    "",
    `## Allowed steps`,
    "",
    "1. `pwd` — print current working directory.",
    "2. `ls` the slice directory.",
    `3. \`cat\` this README (\`README.md\` in the slice directory).`,
    `4. \`echo "dummy slice ${sliceFullId} acknowledged"\` so the run produces visible output.`,
    "",
    `## Validation (the only state change allowed)`,
    "",
    `Run exactly one mutating command, then exit:`,
    "",
    "```",
    `aihub slices move ${sliceFullId} ${transition}`,
    "```",
    "",
    `That transition is the success signal for the orchestrator. No code, tests, commits, or other CLI calls.`,
    "",
    `## Hard stops`,
    "",
    `- If you feel tempted to "implement" anything described above, stop. This is a dummy slice.`,
    `- If a tool prompt asks you to write a file, refuse and exit.`,
    `- If anything is unclear, prefer doing nothing and moving the slice to \`${transition}\` over guessing.`,
  ].join("\n");
}

const dummyProjects = [
  {
    id: "PRO-001",
    folder: "PRO-001_dummy_smoke_a",
    title: "Dummy smoke project A",
    area: "Demo",
    status: "shaping",
    created: "2026-04-28T09:00:00.000Z",
    updated: "2026-05-02T16:42:11.000Z",
    summary:
      "Three-slice fake project used to confirm the orchestrator can dispatch a worker, log a session, and accept a single status transition without anyone writing code.",
    scenario:
      "Lets a developer poke the board UI and the orchestrator end-to-end with realistic-looking data while guaranteeing that no agent run can mutate the repo.",
    slices: [
      {
        num: 1,
        title: "Dummy slice A1 (no-op, already done)",
        status: "done",
        hill: "done",
        purpose:
          "Pre-populated `done` slice so the kanban has something in the Done column. No agent should ever be dispatched against this slice; if one is, it should immediately exit without doing anything.",
        transition: "done",
      },
      {
        num: 2,
        title: "Dummy slice A2 (read-only smoke test)",
        status: "in_progress",
        hill: "executing",
        purpose:
          "Primary smoke-test target. An agent dispatched here should read the slice files, print one acknowledgement line, then transition the slice to `review`.",
        transition: "review",
      },
      {
        num: 3,
        title: "Dummy slice A3 (todo, untouched)",
        status: "todo",
        hill: "figuring",
        purpose:
          "Sits in the Todo column so the kanban has visible variety. If picked up, the agent should perform the read-only steps and move it to `review`.",
        transition: "review",
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
    folder: "PRO-002_dummy_smoke_b_done",
    title: "Dummy smoke project B (already done)",
    area: "Demo",
    status: "done",
    created: "2026-04-15T08:00:00.000Z",
    updated: "2026-04-22T11:08:30.000Z",
    summary:
      "A fake, fully-completed project. Provides material for the Done lifecycle bucket and read-only history views. No agent should ever be dispatched against it.",
    scenario:
      "Used to verify that the board renders historical, untouched projects correctly. If something attempts to dispatch work here, that's a bug in whatever invoked it — not an instruction to do real work.",
    slices: [
      {
        num: 1,
        title: "Dummy slice B1 (frozen, done)",
        status: "done",
        hill: "done",
        purpose:
          "Frozen for display only. Treat as read-only. If an agent is dispatched here, exit immediately without changing anything.",
        transition: "done",
      },
      {
        num: 2,
        title: "Dummy slice B2 (frozen, done)",
        status: "done",
        hill: "done",
        purpose:
          "Frozen for display only. Treat as read-only. If an agent is dispatched here, exit immediately without changing anything.",
        transition: "done",
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
    folder: "PRO-003_dummy_smoke_c_active",
    title: "Dummy smoke project C (active, multi-slice)",
    area: "Demo",
    status: "active",
    created: "2026-05-01T09:00:00.000Z",
    updated: "2026-05-04T12:14:55.000Z",
    summary:
      "Larger fake project with four slices spread across kanban columns. Use it to exercise queueing, multiple parallel sessions, and status transitions — all with strictly read-only agent runs.",
    scenario:
      "Mirrors the shape of a realistic integration project at a tiny scale, purely so screenshots and orchestrator runs have non-trivial data. There is no real codebase target; the `repo` field intentionally points nowhere meaningful for execution.",
    slices: [
      {
        num: 1,
        title: "Dummy slice C1 (already done, do not dispatch)",
        status: "done",
        hill: "done",
        purpose:
          "Pre-populated done slice for kanban display. Do not dispatch.",
        transition: "done",
      },
      {
        num: 2,
        title: "Dummy slice C2 (in review, smoke test)",
        status: "review",
        hill: "executing",
        purpose:
          "Already in review. If a reviewer agent is dispatched, it should read the slice files, print one acknowledgement line, then transition to `ready_to_merge`.",
        transition: "ready_to_merge",
      },
      {
        num: 3,
        title: "Dummy slice C3 (in progress, smoke test)",
        status: "in_progress",
        hill: "executing",
        purpose:
          "Active worker target. Read-only steps only, then move to `review`.",
        transition: "review",
      },
      {
        num: 4,
        title: "Dummy slice C4 (todo, smoke test)",
        status: "todo",
        hill: "figuring",
        purpose:
          "Backlog item. If picked up, perform read-only steps and move to `review`.",
        transition: "review",
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
  const repo = project.repo ?? `/tmp/aihub/${project.folder}`;
  fm.push(`repo: "${repo}"`);
  const body = dummyProjectBody({
    summary: project.summary,
    scenario: project.scenario,
  });
  return `---\n${fm.join("\n")}\n---\n# ${project.title}\n\n${body}\n`;
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
  const body = dummySliceBody({
    purpose: slice.purpose,
    transition: slice.transition,
    sliceFullId: id,
  });
  return `---\nid: "${id}"\nproject_id: "${project.id}"\ntitle: "${slice.title}"\nstatus: "${slice.status}"\nhill_position: "${slice.hill}"\ncreated_at: "${project.created}"\nupdated_at: "${project.updated}"\n---\n# ${slice.title}\n\n${body}\n`;
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
  await rm(projectDir, { recursive: true, force: true });
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
