import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  fetchProjects,
  fetchProject,
  updateProject,
  fetchAgents,
  fetchFullHistory,
  streamMessage,
  fetchSubagents,
  fetchSubagentLogs,
  fetchProjectBranches,
  spawnSubagent,
  interruptSubagent,
} from "../api/client";
import type { ProjectListItem, ProjectDetail, FullHistoryMessage, ContentBlock, SubagentListItem, SubagentLogEvent } from "../api/types";
import { buildProjectSummary, buildStartPrompt } from "./projectMonitoring";

type ColumnDef = { id: string; title: string; color: string };

const COLUMNS: ColumnDef[] = [
  { id: "not_now", title: "Not now", color: "#6b6b6b" },
  { id: "maybe", title: "Maybe", color: "#d2b356" },
  { id: "shaping", title: "Shaping", color: "#4aa3a0" },
  { id: "todo", title: "Todo", color: "#3b6ecc" },
  { id: "in_progress", title: "In Progress", color: "#8a6fd1" },
  { id: "review", title: "Review", color: "#f08b57" },
  { id: "done", title: "Done", color: "#53b97c" },
];

const CLI_OPTIONS = [
  { id: "cli:claude", label: "Claude CLI", cli: "claude" },
  { id: "cli:codex", label: "Codex CLI", cli: "codex" },
  { id: "cli:droid", label: "Droid CLI", cli: "droid" },
  { id: "cli:gemini", label: "Gemini CLI", cli: "gemini" },
];

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = frontmatter?.[key];
  return typeof value === "string" ? value : undefined;
}

function getFrontmatterRecord(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): Record<string, string> | undefined {
  const value = frontmatter?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, string>;
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(ts: string | number | undefined): string {
  if (!ts) return "";
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return timestampFormatter.format(date);
}

function formatCreated(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

function formatCreatedRelative(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86400000));
  if (days === 0) return "Created today";
  if (days === 1) return "Created yesterday";
  if (days === 7) return "Created last week";
  return `Created ${days} days ago`;
}

function renderMarkdown(content: string): string {
  const stripped = content
    .replace(/^\s*---[\s\S]*?\n---\s*\n?/, "")
    .replace(/^\s*#\s+.+\n+/, "");
  const html = marked.parse(stripped, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatJson(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function extractBlockText(text: unknown): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object") {
    const obj = text as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return (obj.content as Array<Record<string, unknown>>)
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    }
  }
  return "";
}

function getTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => extractBlockText((b as { text: unknown }).text))
    .join("\n");
}

function buildAihubLogs(messages: FullHistoryMessage[]): Array<{ ts?: string; type: string; text: string }> {
  const entries: Array<{ ts?: string; type: string; text: string }> = [];
  for (const msg of messages) {
    const ts = formatTimestamp(msg.timestamp);
    if (msg.role === "user") {
      const text = getTextBlocks(msg.content);
      if (text) entries.push({ ts, type: "user", text });
      continue;
    }
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          entries.push({ ts, type: "assistant", text: block.text });
        } else if (block.type === "toolCall") {
          entries.push({ ts, type: "tool_call", text: `${block.name}\n${formatJson(block.arguments)}` });
        }
      }
      continue;
    }
    if (msg.role === "toolResult") {
      const text = getTextBlocks(msg.content);
      if (text) entries.push({ ts, type: "tool_output", text });
      if (msg.details?.diff) {
        entries.push({ ts, type: "diff", text: msg.details.diff });
      }
    }
  }
  return entries;
}

function getStatus(item: ProjectListItem): string {
  return getFrontmatterString(item.frontmatter, "status") ?? "maybe";
}

function normalizeStatus(raw?: string): string {
  if (!raw) return "maybe";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeMode(raw?: string): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function getStatusLabel(status: string): string {
  const match = COLUMNS.find((col) => col.id === status);
  return match ? match.title : status;
}

function sortByCreatedAsc(a: ProjectListItem, b: ProjectListItem): number {
  const aRaw = getFrontmatterString(a.frontmatter, "created");
  const bRaw = getFrontmatterString(b.frontmatter, "created");
  const aTime = aRaw ? Date.parse(aRaw) : Number.POSITIVE_INFINITY;
  const bTime = bRaw ? Date.parse(bRaw) : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

export function ProjectsBoard() {
  const params = useParams();
  const navigate = useNavigate();
  const [projects, { refetch }] = createResource(fetchProjects);
  const [agents] = createResource(fetchAgents);
  const [detail, { refetch: refetchDetail }] = createResource(
    () => params.id,
    async (id) => (id ? fetchProject(id) : null)
  );
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const [detailStatus, setDetailStatus] = createSignal("maybe");
  const [detailDomain, setDetailDomain] = createSignal("");
  const [detailOwner, setDetailOwner] = createSignal("");
  const [detailMode, setDetailMode] = createSignal("");
  const [detailAppetite, setDetailAppetite] = createSignal("");
  const [detailRunAgent, setDetailRunAgent] = createSignal("");
  const [detailRunMode, setDetailRunMode] = createSignal("main-run");
  const [detailRepo, setDetailRepo] = createSignal("");
  const [detailSessionKeys, setDetailSessionKeys] = createSignal<Record<string, string>>({});
  const [detailSlug, setDetailSlug] = createSignal("");
  const [detailBranch, setDetailBranch] = createSignal("main");
  const [branches, setBranches] = createSignal<string[]>([]);
  const [branchesError, setBranchesError] = createSignal<string | null>(null);
  const [mainTab, setMainTab] = createSignal<"logs" | "diffs">("logs");
  const [subTab, setSubTab] = createSignal<"logs" | "diffs">("logs");
  const [mainInput, setMainInput] = createSignal("");
  const [customStartEnabled, setCustomStartEnabled] = createSignal(false);
  const [customStartPrompt, setCustomStartPrompt] = createSignal("");
  const [subagentsExpanded, setSubagentsExpanded] = createSignal(false);
  const [mainLogs, setMainLogs] = createSignal<SubagentLogEvent[]>([]);
  const [mainCursor, setMainCursor] = createSignal(0);
  const [aihubLogs, setAihubLogs] = createSignal<Array<{ ts?: string; type: string; text: string }>>([]);
  const [aihubLive, setAihubLive] = createSignal("");
  const [aihubStreaming, setAihubStreaming] = createSignal(false);
  const [mainError, setMainError] = createSignal("");
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [subagentError, setSubagentError] = createSignal<string | null>(null);
  const [selectedSubagent, setSelectedSubagent] = createSignal<string | null>(null);
  const [subagentLogs, setSubagentLogs] = createSignal<SubagentLogEvent[]>([]);
  const [subagentCursor, setSubagentCursor] = createSignal(0);
  const [openMenu, setOpenMenu] = createSignal<"status" | "appetite" | "domain" | "owner" | "mode" | null>(null);

  let mainStreamCleanup: (() => void) | null = null;

  const ownerOptions = createMemo(() => {
    const names = (agents() ?? []).map((agent) => agent.name);
    return ["Thinh", ...names.filter((name) => name !== "Thinh")];
  });

  const runAgentOptions = createMemo(() => {
    const aihub = (agents() ?? []).map((agent) => ({
      id: `aihub:${agent.id}`,
      label: agent.name,
    }));
    return [...aihub, ...CLI_OPTIONS];
  });

  const selectedRunAgent = createMemo(() => {
    const value = detailRunAgent();
    if (!value) return null;
    if (value.startsWith("aihub:")) return { type: "aihub" as const, id: value.slice(6) };
    if (value.startsWith("cli:")) return { type: "cli" as const, id: value.slice(4) };
    return null;
  });

  const mainSlug = createMemo(() => {
    if (selectedRunAgent()?.type !== "cli") return "";
    if (detailRunMode() === "worktree") return detailSlug().trim();
    return "main";
  });

  const mainSubagent = createMemo(() => {
    const slug = mainSlug();
    if (!slug) return null;
    return subagents().find((item) => item.slug === slug) ?? null;
  });

  const resolvedSessionKey = createMemo(() => {
    const project = detail();
    const agent = selectedRunAgent();
    if (!project || !agent || agent.type !== "aihub") return "";
    return detailSessionKeys()[agent.id] ?? `project:${project.id}:${agent.id}`;
  });

  const hasMainRun = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return false;
    if (agent.type === "aihub") {
      return aihubStreaming() || aihubLogs().length > 0 || Boolean(detailSessionKeys()[agent.id]);
    }
    return Boolean(mainSubagent());
  });

  const canStart = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return false;
    if (agent.type === "aihub") return true;
    if (!detailRepo()) return false;
    if (detailRunMode() === "worktree" && !detailSlug().trim()) return false;
    return true;
  });

  const mainStatus = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return "idle";
    if (agent.type === "aihub") {
      return aihubStreaming() ? "running" : hasMainRun() ? "idle" : "idle";
    }
    return mainSubagent()?.status ?? "idle";
  });

  const grouped = createMemo(() => {
    const items = projects() ?? [];
    const byStatus = new Map<string, ProjectListItem[]>();
    for (const col of COLUMNS) byStatus.set(col.id, []);
    for (const item of items) {
      const status = getStatus(item);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status)?.push(item);
    }
    for (const [status, list] of byStatus) {
      list.sort(sortByCreatedAsc);
    }
    return byStatus;
  });

  createEffect(() => {
    if (expanded().length > 0) return;
    const items = projects() ?? [];
    if (items.length === 0) {
      setExpanded(COLUMNS.slice(0, 2).map((col) => col.id));
      return;
    }
    const withItems = COLUMNS.filter((col) =>
      items.some((item) => getStatus(item) === col.id)
    ).map((col) => col.id);
    setExpanded(withItems.slice(0, 2).length > 0 ? withItems.slice(0, 2) : COLUMNS.slice(0, 2).map((col) => col.id));
  });

  createEffect(() => {
    const current = detail();
    if (current) {
      setDetailStatus(normalizeStatus(getFrontmatterString(current.frontmatter, "status")));
      setDetailDomain(getFrontmatterString(current.frontmatter, "domain") ?? "");
      setDetailOwner(getFrontmatterString(current.frontmatter, "owner") ?? "");
      setDetailMode(normalizeMode(getFrontmatterString(current.frontmatter, "executionMode")));
      setDetailAppetite(getFrontmatterString(current.frontmatter, "appetite") ?? "");
      setDetailRunAgent(getFrontmatterString(current.frontmatter, "runAgent") ?? "");
      setDetailRunMode(getFrontmatterString(current.frontmatter, "runMode") ?? "main-run");
      setDetailRepo(getFrontmatterString(current.frontmatter, "repo") ?? "");
      setDetailSessionKeys(getFrontmatterRecord(current.frontmatter, "sessionKeys") ?? {});
      if (!detailSlug()) {
        const nextSlug = slugify(current.title);
        if (nextSlug) setDetailSlug(nextSlug);
      }
      setOpenMenu(null);
    }
  });

  createEffect(() => {
    if (!params.id) return;
    setMainLogs([]);
    setMainCursor(0);
    setAihubLogs([]);
    setAihubLive("");
    setAihubStreaming(false);
    setMainError("");
    setSubagents([]);
    setSelectedSubagent(null);
    setSubagentLogs([]);
    setSubagentCursor(0);
    setDetailSlug("");
  });

  createEffect(() => {
    if (!detail() || detailRunAgent()) return;
    const options = runAgentOptions();
    if (options.length > 0) {
      const isShaping = detailStatus() === "shaping";
      const projectManager = options.find((opt) => opt.label === "Project Manager");
      const aihub = options.find((opt) => opt.id.startsWith("aihub:"));
      const defaultOption = isShaping && projectManager ? projectManager : aihub ?? options[0];
      setDetailRunAgent(defaultOption.id);
    }
  });

  createEffect(() => {
    if (!params.id) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetail();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  onCleanup(() => {
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
  });

  createEffect(() => {
    if (!openMenu()) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".meta-field")) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  createEffect(() => {
    const projectId = params.id;
    const repo = detailRepo();
    if (!projectId || !repo) {
      setBranches([]);
      setBranchesError(null);
      return;
    }
    let active = true;
    const load = async () => {
      const res = await fetchProjectBranches(projectId);
      if (!active) return;
      if (res.ok) {
        setBranches(res.data.branches);
        setBranchesError(null);
        if (!res.data.branches.includes(detailBranch())) {
          setDetailBranch(res.data.branches.includes("main") ? "main" : res.data.branches[0] ?? "main");
        }
      } else {
        setBranches([]);
        setBranchesError(res.error);
      }
    };
    load();
  });

  createEffect(() => {
    const projectId = params.id;
    if (!projectId) return;
    let active = true;
    const load = async () => {
      const res = await fetchSubagents(projectId);
      if (!active) return;
      if (res.ok) {
        setSubagents(res.data.items);
        setSubagentError(null);
      } else {
        setSubagentError(res.error);
      }
    };
    load();
    const timer = setInterval(load, 2000);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  createEffect(() => {
    const project = detail();
    const agent = selectedRunAgent();
    if (!project || !agent || agent.type !== "aihub") return;
    if (aihubStreaming()) return;
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    const load = async () => {
      const res = await fetchFullHistory(agent.id, sessionKey);
      setAihubLogs(buildAihubLogs(res.messages));
    };
    load();
  });

  createEffect(() => {
    const projectId = params.id;
    const agent = selectedRunAgent();
    const slug = mainSlug();
    if (!projectId || !agent || agent.type !== "cli" || !slug) return;
    setMainLogs([]);
    setMainCursor(0);
    let active = true;
    let cursor = 0;
    const poll = async () => {
      const res = await fetchSubagentLogs(projectId, slug, cursor);
      if (!active) return;
      if (res.ok) {
        if (res.data.events.length > 0) {
          setMainLogs((prev) => [...prev, ...res.data.events]);
        }
        cursor = res.data.cursor;
        setMainCursor(cursor);
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  createEffect(() => {
    const projectId = params.id;
    const slug = selectedSubagent();
    if (!projectId || !slug) return;
    setSubagentLogs([]);
    setSubagentCursor(0);
    let active = true;
    let cursor = 0;
    const poll = async () => {
      const res = await fetchSubagentLogs(projectId, slug, cursor);
      if (!active) return;
      if (res.ok) {
        if (res.data.events.length > 0) {
          setSubagentLogs((prev) => [...prev, ...res.data.events]);
        }
        cursor = res.data.cursor;
        setSubagentCursor(cursor);
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  createEffect(() => {
    if (selectedRunAgent()?.type === "aihub" && mainTab() !== "logs") {
      setMainTab("logs");
    }
  });

  const toggleColumn = (id: string) => {
    setExpanded((prev) => {
      if (prev.includes(id)) return prev.filter((col) => col !== id);
      if (prev.length >= 2) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleStatusChange = async (id: string, status: string) => {
    setDetailStatus(status);
    await updateProject(id, { status });
    await refetch();
    await refetchDetail();
  };

  const handleDomainChange = async (id: string, domain: string) => {
    setDetailDomain(domain);
    await updateProject(id, { domain });
    await refetch();
    await refetchDetail();
  };

  const handleOwnerChange = async (id: string, owner: string) => {
    setDetailOwner(owner);
    await updateProject(id, { owner });
    await refetch();
    await refetchDetail();
  };

  const handleModeChange = async (id: string, mode: string) => {
    setDetailMode(mode);
    await updateProject(id, { executionMode: mode });
    await refetch();
    await refetchDetail();
  };

  const handleAppetiteChange = async (id: string, appetite: string) => {
    setDetailAppetite(appetite);
    await updateProject(id, { appetite });
    await refetch();
    await refetchDetail();
  };

  const handleRunAgentChange = async (id: string, runAgent: string) => {
    setDetailRunAgent(runAgent);
    await updateProject(id, { runAgent });
    await refetchDetail();
  };

  const handleRunModeChange = async (id: string, runMode: string) => {
    setDetailRunMode(runMode);
    await updateProject(id, { runMode });
    await refetchDetail();
  };

  const handleRepoSave = async (id: string) => {
    await updateProject(id, { repo: detailRepo() });
    await refetchDetail();
  };

  const openDetail = (id: string) => {
    navigate(`/projects/${id}`);
  };

  const closeDetail = () => {
    navigate("/projects");
  };

  const startAihubRun = async (project: ProjectDetail, customPrompt: string) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "aihub") return;
    const sessionKeys = detailSessionKeys();
    let sessionKey = sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
    if (!sessionKeys[agent.id]) {
      const nextKeys = { ...sessionKeys, [agent.id]: sessionKey };
      setDetailSessionKeys(nextKeys);
      await updateProject(project.id, { sessionKeys: nextKeys, runAgent: detailRunAgent() });
      await refetchDetail();
    }
    const summary = buildProjectSummary(
      project.title,
      getFrontmatterString(project.frontmatter, "status") ?? "",
      project.content
    );
    const basePrompt = buildStartPrompt(summary);
    const prompt = customPrompt ? `${basePrompt}\n\n${customPrompt}` : basePrompt;
    setMainError("");
    setAihubLogs([]);
    setAihubLive("");
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    setAihubStreaming(true);
    setAihubLogs((prev) => [
      ...prev,
      { ts: formatTimestamp(Date.now()), type: "user", text: prompt },
    ]);
    mainStreamCleanup = streamMessage(
      agent.id,
      prompt,
      sessionKey,
      (text) => {
        setAihubLive((prev) => prev + text);
      },
      async () => {
        setAihubStreaming(false);
        setAihubLive("");
        const res = await fetchFullHistory(agent.id, sessionKey);
        setAihubLogs(buildAihubLogs(res.messages));
        mainStreamCleanup = null;
      },
      (error) => {
        setMainError(error);
        setAihubStreaming(false);
        setAihubLive("");
        mainStreamCleanup = null;
      },
      {
        onToolCall: (_id, name, args) => {
          setAihubLogs((prev) => [
            ...prev,
            { ts: formatTimestamp(Date.now()), type: "tool_call", text: `${name}\n${formatJson(args)}` },
          ]);
        },
      }
    );
  };

  const sendAihubMessage = async (project: ProjectDetail, message: string) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "aihub") return;
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    setMainError("");
    setAihubLive("");
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    setAihubStreaming(true);
    setAihubLogs((prev) => [
      ...prev,
      { ts: formatTimestamp(Date.now()), type: "user", text: message },
    ]);
    mainStreamCleanup = streamMessage(
      agent.id,
      message,
      sessionKey,
      (text) => {
        setAihubLive((prev) => prev + text);
      },
      async () => {
        setAihubStreaming(false);
        setAihubLive("");
        const res = await fetchFullHistory(agent.id, sessionKey);
        setAihubLogs(buildAihubLogs(res.messages));
        mainStreamCleanup = null;
      },
      (error) => {
        setMainError(error);
        setAihubStreaming(false);
        setAihubLive("");
        mainStreamCleanup = null;
      }
    );
  };

  const runCli = async (project: ProjectDetail, message: string, resume: boolean) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "cli") return;
    const slug = mainSlug();
    if (!slug) {
      setMainError("Slug required");
      return;
    }
    setMainError("");
    const res = await spawnSubagent(project.id, {
      slug,
      cli: agent.id,
      prompt: message,
      mode: detailRunMode() === "worktree" ? "worktree" : "main-run",
      baseBranch: detailBranch(),
      resume,
    });
    if (!res.ok) {
      setMainError(res.error);
    }
  };

  const handleStart = async (project: ProjectDetail) => {
    const agent = selectedRunAgent();
    if (!agent) return;
    const custom = customStartEnabled() ? customStartPrompt().trim() : "";
    if (agent.type === "aihub") {
      await startAihubRun(project, custom);
      return;
    }
    if (detailRunAgent()) {
      await updateProject(project.id, { runAgent: detailRunAgent(), runMode: detailRunMode() });
    }
    const summary = buildProjectSummary(
      project.title,
      getFrontmatterString(project.frontmatter, "status") ?? "",
      project.content
    );
    const basePrompt = buildStartPrompt(summary);
    const prompt = custom ? `${basePrompt}\n\n${custom}` : basePrompt;
    await runCli(project, prompt, false);
  };

  const handleSend = async (project: ProjectDetail) => {
    const message = mainInput().trim();
    if (!message) return;
    setMainInput("");
    const agent = selectedRunAgent();
    if (!agent) return;
    if (agent.type === "aihub") {
      await sendAihubMessage(project, message);
      return;
    }
    await runCli(project, message, true);
  };

  const handleStop = async (project: ProjectDetail) => {
    const agent = selectedRunAgent();
    if (!agent) return;
    if (agent.type === "cli") {
      const slug = mainSlug();
      if (!slug) return;
      await interruptSubagent(project.id, slug);
      return;
    }
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    streamMessage(
      agent.id,
      "/abort",
      sessionKey,
      () => {},
      () => {},
      () => {}
    );
  };

  return (
    <div class="projects-page">
      <header class="projects-header">
        <A href="/" class="back-btn" aria-label="Go back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </A>
        <div class="header-title">
          <h1>Projects</h1>
          <span class="header-subtitle">Kanban</span>
        </div>
      </header>

      <Show when={projects.loading}>
        <div class="projects-loading">Loading projects...</div>
      </Show>
      <Show when={projects.error}>
        <div class="projects-error">Failed to load projects</div>
      </Show>

      <div class="board">
        <For each={COLUMNS}>
          {(column) => {
            const items = () => grouped().get(column.id) ?? [];
            const isExpanded = () => expanded().includes(column.id);
            return (
              <section
                class={`column ${isExpanded() ? "expanded" : "collapsed"}`}
                style={{ "--col": column.color }}
              >
                <button class="column-header" onClick={() => toggleColumn(column.id)}>
                  <div class="column-title">{column.title}</div>
                  <div class="column-count">{items().length}</div>
                </button>
                <Show when={isExpanded()}>
                  <div class="column-body">
                    <Show when={items().length === 0}>
                      <div class="empty-state">No projects</div>
                    </Show>
                    <For each={items()}>
                      {(item) => {
                        const fm = item.frontmatter ?? {};
                        const owner = getFrontmatterString(fm, "owner");
                        const domain = getFrontmatterString(fm, "domain");
                        const mode = getFrontmatterString(fm, "executionMode");
                        const appetite = getFrontmatterString(fm, "appetite");
                        const created = getFrontmatterString(fm, "created");
                        return (
                          <button class="card" onClick={() => openDetail(item.id)}>
                            <div class="card-id">{item.id}</div>
                            <div class="card-title">{item.title}</div>
                            <div class="card-meta">
                              <Show when={owner}><span>{owner}</span></Show>
                              <Show when={domain}><span>{domain}</span></Show>
                              <Show when={mode}><span>{mode}</span></Show>
                              <Show when={appetite}><span>{appetite}</span></Show>
                            </div>
                            <div class="card-footer">
                              <span>{created ? formatCreatedRelative(created) : ""}</span>
                            </div>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </div>

      <Show when={params.id}>
        <div class="overlay" role="dialog" aria-modal="true">
          <div class="overlay-backdrop" onClick={closeDetail} />
          <div class="overlay-panel">
            <button class="overlay-close" onClick={closeDetail} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
            <div class="overlay-header">
              <Show when={detail()}>
                {(data) => {
                  const project = data() as ProjectDetail;
                  return (
                    <>
                      <div class="title-block">
                        <span class="id-pill">{project.id}</span>
                        <h2>{project.title}</h2>
                      </div>
                    </>
                  );
                }}
              </Show>
              <Show when={detail.loading}>
                <h2>Loading...</h2>
              </Show>
            </div>
            <div class="overlay-content">
              <div class="detail">
                <Show when={detail.loading}>
                  <div class="projects-loading">Loading...</div>
                </Show>
                <Show when={detail.error}>
                  <div class="projects-error">Failed to load project</div>
                </Show>
                <Show when={detail()}>
                  {(data) => {
                    const project = data() as ProjectDetail;
                    const fm = project.frontmatter ?? {};
                    return (
                      <>
                        <div class="detail-meta">
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "status" ? null : "status")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M5 12l4 4L19 6" />
                              </svg>
                              {detailStatus() ? getStatusLabel(detailStatus()) : "status"}
                            </button>
                            <Show when={openMenu() === "status"}>
                              <div class="meta-menu">
                                <For each={COLUMNS}>
                                  {(col) => (
                                    <button class="meta-item" onClick={() => handleStatusChange(project.id, col.id)}>
                                      {col.title}
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <span class="meta-chip">
                            <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <circle cx="12" cy="12" r="9" />
                              <path d="M12 7v5l3 3" />
                            </svg>
                            {formatCreatedRelative(getFrontmatterString(fm, "created"))}
                          </span>
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "appetite" ? null : "appetite")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 3v18" />
                                <path d="M7 8h10" />
                                <path d="M6 13h12" />
                                <path d="M5 18h14" />
                              </svg>
                              {detailAppetite() || "appetite"}
                            </button>
                            <Show when={openMenu() === "appetite"}>
                              <div class="meta-menu">
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "")}>unset</button>
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "small")}>small</button>
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "big")}>big</button>
                              </div>
                            </Show>
                          </div>
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "domain" ? null : "domain")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 7H10l-6 5 6 5h10l-4-5z" />
                              </svg>
                              {detailDomain() || "domain"}
                            </button>
                            <Show when={openMenu() === "domain"}>
                              <div class="meta-menu">
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "")}>unset</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "life")}>life</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "admin")}>admin</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "coding")}>coding</button>
                              </div>
                            </Show>
                          </div>
                        </div>
                        <div class="detail-body" innerHTML={renderMarkdown(project.content)} />
                      </>
                    );
                  }}
                </Show>
              </div>
              <div class="monitoring">
                <div class="monitoring-meta">
                  <div class="meta-field">
                    <button
                      class="meta-button"
                      onClick={() => setOpenMenu(openMenu() === "owner" ? null : "owner")}
                    >
                      <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c2.5-4 13.5-4 16 0" />
                      </svg>
                      {detailOwner() || "owner"}
                    </button>
                    <Show when={openMenu() === "owner"}>
                      <div class="meta-menu">
                        <button class="meta-item" onClick={() => handleOwnerChange(params.id ?? "", "")}>unset</button>
                        <For each={ownerOptions()}>
                          {(owner) => (
                            <button class="meta-item" onClick={() => handleOwnerChange(params.id ?? "", owner)}>
                              {owner}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <div class="meta-field">
                    <button
                      class="meta-button"
                      onClick={() => setOpenMenu(openMenu() === "mode" ? null : "mode")}
                    >
                      <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 6h16M8 6v12M16 12v6" />
                      </svg>
                      {detailMode() ? detailMode().replace(/_/g, " ") : "execution mode"}
                    </button>
                    <Show when={openMenu() === "mode"}>
                      <div class="meta-menu">
                        <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "")}>unset</button>
                        <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "manual")}>manual</button>
                        <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "exploratory")}>exploratory</button>
                        <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "auto")}>auto</button>
                        <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "full_auto")}>full auto</button>
                      </div>
                    </Show>
                  </div>
                  <div class="meta-field">
                    <label class="meta-label">Agent</label>
                    <select
                      class="meta-select"
                      value={detailRunAgent()}
                      onChange={(e) => handleRunAgentChange(params.id ?? "", e.currentTarget.value)}
                    >
                      <For each={runAgentOptions()}>
                        {(opt) => (
                          <option value={opt.id}>{opt.label}</option>
                        )}
                      </For>
                    </select>
                  </div>
                  <Show when={selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field">
                      <label class="meta-label">Run mode</label>
                      <select
                        class="meta-select"
                        value={detailRunMode()}
                        onChange={(e) => handleRunModeChange(params.id ?? "", e.currentTarget.value)}
                      >
                        <option value="main-run">main-run</option>
                        <option value="worktree">worktree</option>
                      </select>
                    </div>
                  </Show>
                  <Show when={detailDomain() === "coding" && selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field meta-field-wide">
                      <label class="meta-label">Repo</label>
                      <input
                        class="meta-input"
                        value={detailRepo()}
                        onInput={(e) => setDetailRepo(e.currentTarget.value)}
                        onBlur={() => handleRepoSave(params.id ?? "")}
                        placeholder="/abs/path/to/repo"
                      />
                    </div>
                  </Show>
                  <Show when={selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field">
                      <label class="meta-label">Base branch</label>
                      <select
                        class="meta-select"
                        value={detailBranch()}
                        onChange={(e) => setDetailBranch(e.currentTarget.value)}
                        disabled={branches().length === 0}
                      >
                        <For each={branches().length > 0 ? branches() : ["main"]}>
                          {(branch) => <option value={branch}>{branch}</option>}
                        </For>
                      </select>
                    </div>
                  </Show>
                  <Show when={selectedRunAgent()?.type === "cli" && detailRunMode() === "worktree"}>
                    <div class="meta-field">
                      <label class="meta-label">Slug</label>
                      <input
                        class="meta-input"
                        value={detailSlug()}
                        onInput={(e) => setDetailSlug(e.currentTarget.value)}
                        placeholder="short-slug"
                      />
                    </div>
                  </Show>
                </div>
                <div
                  class={`monitoring-columns ${
                    detailDomain() === "coding"
                      ? subagentsExpanded()
                        ? "subagents-only"
                        : "split"
                      : "main-only"
                  }`}
                >
                  <Show when={detailDomain() === "coding" && subagentsExpanded()}>
                    <button
                      class="main-toggle-rail"
                      onClick={() => setSubagentsExpanded(false)}
                      aria-label="Show main agent"
                    >
                      <span>Main</span>
                    </button>
                  </Show>
                  <Show when={detailDomain() !== "coding" || !subagentsExpanded()}>
                    <div class="monitoring-main">
                      <div class="monitoring-header-row">
                      <div class={`status-pill ${mainStatus()}`}>
                        <span class="status-dot" />
                        <span class="status-text">{mainStatus()}</span>
                      </div>
                      <Show when={detailDomain() === "coding"}>
                        <button
                          class="collapse-btn"
                          onClick={() => setSubagentsExpanded(true)}
                          disabled={subagentsExpanded()}
                          aria-label="Expand subagents panel"
                        >
                          Subagents
                        </button>
                      </Show>
                      <label class="start-custom-toggle">
                        <input
                          type="checkbox"
                          checked={customStartEnabled()}
                          onChange={(e) => setCustomStartEnabled(e.currentTarget.checked)}
                        />
                        <span>custom prompt</span>
                      </label>
                      <Show when={!hasMainRun()}>
                        <button
                          class="start-btn"
                          onClick={() => {
                            const current = detail() as ProjectDetail | null;
                            if (current) handleStart(current);
                          }}
                          disabled={!canStart()}
                        >
                          Start
                        </button>
                      </Show>
                      <Show when={hasMainRun()}>
                        <button
                          class="stop-btn"
                          onClick={() => {
                            const current = detail() as ProjectDetail | null;
                            if (current) handleStop(current);
                          }}
                          disabled={mainStatus() !== "running"}
                        >
                          Stop
                        </button>
                      </Show>
                    </div>
                    <Show when={branchesError()}>
                      <div class="monitoring-error">{branchesError()}</div>
                    </Show>
                    <Show when={!hasMainRun()}>
                      <div class="monitoring-empty">
                        <p>Start a run to see logs.</p>
                      </div>
                    </Show>
                    <Show when={customStartEnabled()}>
                      <textarea
                        class="custom-start-textarea"
                        rows={2}
                        value={customStartPrompt()}
                        placeholder="Add a one-off custom prompt..."
                        onInput={(e) => setCustomStartPrompt(e.currentTarget.value)}
                      />
                    </Show>
                    <Show when={hasMainRun()}>
                      <div class="monitoring-tabs">
                        <button
                          class={`tab-btn ${mainTab() === "logs" ? "active" : ""}`}
                          onClick={() => setMainTab("logs")}
                        >
                          Logs
                        </button>
                        <Show when={selectedRunAgent()?.type === "cli"}>
                          <button
                            class={`tab-btn ${mainTab() === "diffs" ? "active" : ""}`}
                            onClick={() => setMainTab("diffs")}
                          >
                            Diffs
                          </button>
                        </Show>
                      </div>
                      <div class="log-pane">
                        <Show when={selectedRunAgent()?.type === "aihub"}>
                          <For each={aihubLogs()}>
                            {(entry) => (
                              <div class={`log-line ${entry.type}`}>
                                <span class="log-time">{entry.ts}</span>
                                <span class="log-kind">{entry.type}</span>
                                <pre class="log-text">{entry.text}</pre>
                              </div>
                            )}
                          </For>
                          <Show when={aihubLive()}>
                            <div class="log-line live">
                              <span class="log-time">live</span>
                              <span class="log-kind">assistant</span>
                              <pre class="log-text">{aihubLive()}</pre>
                            </div>
                          </Show>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "cli"}>
                          <For
                            each={
                              mainTab() === "diffs"
                                ? mainLogs().filter((ev) => ev.type === "diff")
                                : mainLogs()
                            }
                          >
                            {(entry) => (
                              <div class={`log-line ${entry.type}`}>
                                <span class="log-time">{entry.ts ? formatTimestamp(entry.ts) : ""}</span>
                                <span class="log-kind">{entry.type}</span>
                                <pre class="log-text">{entry.text ?? ""}</pre>
                              </div>
                            )}
                          </For>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "cli" && mainLogs().length === 0}>
                          <div class="log-empty">No logs yet.</div>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "aihub" && aihubLogs().length === 0 && !aihubLive()}>
                          <div class="log-empty">No logs yet.</div>
                        </Show>
                      </div>
                      <div class="monitoring-input">
                      <textarea
                        class="monitoring-textarea"
                        rows={1}
                        value={mainInput()}
                        placeholder="Send a follow-up..."
                        onInput={(e) => setMainInput(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            const current = detail() as ProjectDetail | null;
                            if (current) handleSend(current);
                          }
                        }}
                      />
                        <button
                          class="monitoring-send"
                          onClick={() => {
                            const current = detail() as ProjectDetail | null;
                            if (current) handleSend(current);
                          }}
                          disabled={!mainInput().trim()}
                        >
                          Send
                        </button>
                      </div>
                      <Show when={mainError()}>
                        <div class="monitoring-error">{mainError()}</div>
                      </Show>
                    </Show>
                  </div>
                  </Show>
                  <Show when={detailDomain() === "coding"}>
                    <div class={`subagents-panel ${subagentsExpanded() ? "expanded" : "collapsed"}`}>
                      <button
                        class="subagents-toggle"
                        onClick={() => setSubagentsExpanded((prev) => !prev)}
                      >
                        <span>Subagents</span>
                        <span class="subagents-count">{subagents().length}</span>
                      </button>
                      <Show when={subagentsExpanded()}>
                        <div class="subagents-body">
                          <Show when={subagentError()}>
                            <div class="monitoring-error">{subagentError()}</div>
                          </Show>
                          <div class="subagents-list">
                            <For each={subagents().filter((item) => item.slug !== mainSlug())}>
                              {(item) => (
                                <button
                                  class={`subagent-row ${selectedSubagent() === item.slug ? "active" : ""}`}
                                  onClick={() => setSelectedSubagent(item.slug)}
                                >
                                  <div class="subagent-title">{item.slug}</div>
                                  <div class="subagent-meta">
                                    <span>{item.cli ?? "cli"}</span>
                                    <span class={`subagent-status ${item.status}`}>{item.status}</span>
                                    <span>{item.lastActive ? formatTimestamp(item.lastActive) : ""}</span>
                                  </div>
                                </button>
                              )}
                            </For>
                            <Show when={subagents().filter((item) => item.slug !== mainSlug()).length === 0}>
                              <div class="log-empty">No subagents yet.</div>
                            </Show>
                          </div>
                          <Show when={selectedSubagent()}>
                            <div class="subagent-logs">
                              <div class="monitoring-tabs">
                                <button
                                  class={`tab-btn ${subTab() === "logs" ? "active" : ""}`}
                                  onClick={() => setSubTab("logs")}
                                >
                                  Logs
                                </button>
                                <button
                                  class={`tab-btn ${subTab() === "diffs" ? "active" : ""}`}
                                  onClick={() => setSubTab("diffs")}
                                >
                                  Diffs
                                </button>
                              </div>
                              <div class="log-pane">
                                <For
                                  each={
                                    subTab() === "diffs"
                                      ? subagentLogs().filter((ev) => ev.type === "diff")
                                      : subagentLogs()
                                  }
                                >
                                  {(entry) => (
                                    <div class={`log-line ${entry.type}`}>
                                      <span class="log-time">{entry.ts ? formatTimestamp(entry.ts) : ""}</span>
                                      <span class="log-kind">{entry.type}</span>
                                      <pre class="log-text">{entry.text ?? ""}</pre>
                                    </div>
                                  )}
                                </For>
                                <Show when={subagentLogs().length === 0}>
                                  <div class="log-empty">No logs yet.</div>
                                </Show>
                              </div>
                              <button
                                class="stop-btn subagent-stop"
                                onClick={() => {
                                  const current = detail() as ProjectDetail | null;
                                  if (current && selectedSubagent()) {
                                    interruptSubagent(current.id, selectedSubagent()!);
                                  }
                                }}
                              >
                                Stop
                              </button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <style>{`
        .projects-page {
          width: 100vw;
          margin-left: calc(50% - 50vw);
          height: 100%;
          display: flex;
          flex-direction: column;
          font-family: "Adwaita Sans", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
          color: #f2f2f2;
          background: #0c0e12;
        }

        .projects-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid #1f242c;
          position: sticky;
          top: 0;
          background: #0c0e12;
          z-index: 5;
        }

        .back-btn {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: #131821;
          border: 1px solid #232a35;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #b8c0cc;
        }

        .header-title h1 {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .header-subtitle {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #7f8a9a;
        }

        .projects-loading,
        .projects-error {
          padding: 24px;
          text-align: center;
          color: #8d97a6;
        }

        .board {
          display: flex;
          gap: 12px;
          padding: 18px 18px 36px;
          overflow-x: auto;
          overflow-y: hidden;
        }

        .board::-webkit-scrollbar {
          height: 6px;
        }

        .board::-webkit-scrollbar-thumb {
          background: #1d2430;
          border-radius: 999px;
        }

        .column {
          min-width: 240px;
          max-width: 320px;
          background: color-mix(in oklch, var(--col) 6%, #0c0e12 94%);
          border: 1px solid color-mix(in oklch, var(--col) 35%, #1d2430 65%);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          transition: all 0.2s ease;
        }

        .column.collapsed {
          min-width: 70px;
          max-width: 70px;
          padding-bottom: 12px;
        }

        .column-header {
          border: none;
          background: transparent;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          cursor: pointer;
        }

        .column-title {
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: color-mix(in oklch, var(--col) 80%, #f1f4f8 20%);
        }

        .column-count {
          background: color-mix(in oklch, var(--col) 35%, #141a22 65%);
          color: #e7edf5;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 12px;
          font-weight: 700;
        }

        .column.collapsed .column-header {
          flex-direction: column;
          gap: 8px;
        }

        .column.collapsed .column-title {
          writing-mode: vertical-rl;
          text-orientation: sideways-left;
          font-size: 12px;
        }

        .column-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 0 12px 16px;
          overflow-y: auto;
          max-height: calc(100vh - 180px);
        }

        .empty-state {
          padding: 16px;
          text-align: center;
          color: #788391;
          border: 1px dashed color-mix(in oklch, var(--col) 40%, #232a35 60%);
          border-radius: 12px;
          font-size: 13px;
        }

        .card {
          background: color-mix(in oklch, var(--col) 8%, #0f141c 92%);
          border: 1px solid color-mix(in oklch, var(--col) 30%, #1f2631 70%);
          border-radius: 14px;
          padding: 12px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .card-id {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.2em;
          color: color-mix(in oklch, var(--col) 70%, #aeb6c2 30%);
        }

        .card-title {
          font-size: 16px;
          font-weight: 700;
          line-height: 1.2;
        }

        .card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 10px;
          font-size: 12px;
          color: color-mix(in oklch, var(--col) 55%, #c1c8d2 45%);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .card-footer {
          font-size: 12px;
          color: #9aa3b2;
        }

        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .overlay-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
        }

        .overlay-panel {
          position: relative;
          width: min(1920px, 96vw);
          height: min(90vh, 900px);
          background: #0f141c;
          border: 1px solid #273042;
          border-radius: 20px;
          z-index: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          gap: 16px;
        }

        .overlay-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid #2a3240;
          background: #151c26;
          color: #c6ceda;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .title-block {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .overlay-header h2 {
          font-size: 20px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .id-pill {
          background: #141a23;
          border: 1px solid #2a3240;
          color: #9aa3b2;
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          padding: 6px 10px;
          border-radius: 999px;
        }

        .overlay-content {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 16px;
          height: 100%;
        }

        .detail,
        .monitoring {
          background: #111722;
          border: 1px solid #273042;
          border-radius: 16px;
          padding: 16px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .detail-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .status-select {
          background: #151c26;
          color: #e0e6ef;
          border: 1px solid #2a3240;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          font-size: 12px;
          color: #9aa3b2;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .meta-field {
          position: relative;
        }

        .meta-button {
          background: transparent;
          color: inherit;
          border: none;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
          padding: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .meta-button:focus {
          outline: none;
          color: #e4e9f1;
        }

        .meta-icon {
          width: 12px;
          height: 12px;
          opacity: 0.55;
        }

        .meta-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          background: #151c26;
          border: 1px solid #2a3240;
          border-radius: 10px;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
          z-index: 5;
        }

        .meta-item {
          background: transparent;
          border: none;
          color: #e0e6ef;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 11px;
          text-align: left;
          padding: 6px 8px;
          border-radius: 8px;
          cursor: pointer;
        }

        .meta-item:hover {
          background: #232c3a;
        }

        .monitoring-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          align-items: end;
        }

        .meta-label {
          display: block;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #7f8a9a;
          margin-bottom: 6px;
        }

        .meta-select,
        .meta-input {
          width: 100%;
          background: #151c26;
          color: #e0e6ef;
          border: 1px solid #2a3240;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .meta-input::placeholder {
          color: #7f8a9a;
        }

        .meta-field-wide {
          grid-column: span 2;
        }

        .detail-body {
          flex: 1;
          overflow: auto;
          background: transparent;
          border: none;
          padding: 0;
          color: #d4dbe5;
          font-size: 14px;
          line-height: 1.5;
        }

        .detail-body :is(h1, h2, h3) {
          margin: 1em 0 0.5em;
        }

        .detail-body p {
          margin: 0 0 0.8em;
        }

        .detail-body hr {
          border: none;
          border-top: 1px solid #2a3240;
          margin: 1.2em 0;
        }

        .detail-body ul,
        .detail-body ol {
          margin: 0 0 1em 1.2em;
          padding: 0;
        }

        .detail-body li {
          margin: 0.35em 0;
        }

        .monitoring-main {
          display: flex;
          flex-direction: column;
          gap: 12px;
          border: 1px solid #233041;
          border-radius: 14px;
          padding: 12px;
          background: #0f1520;
          flex: 1;
          min-height: 0;
        }

        .monitoring-columns {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          flex: 1;
          min-height: 0;
        }

        .monitoring-columns.main-only {
          grid-template-columns: minmax(0, 1fr);
        }

        .monitoring-columns.subagents-only {
          grid-template-columns: 58px minmax(0, 1fr);
        }

        .monitoring-columns.split {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        .main-toggle-rail {
          width: 58px;
          padding: 8px 6px;
          border: 1px solid #233041;
          border-radius: 14px;
          background: #0f1520;
          color: #98a3b2;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }


        .monitoring-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .collapse-btn {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #98a3b2;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
        }

        .collapse-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .start-custom-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8b96a5;
        }

        .start-custom-toggle input {
          accent-color: #3b6ecc;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #9aa3b2;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #5b6470;
        }

        .status-pill.running .status-dot {
          background: #53b97c;
          box-shadow: 0 0 8px rgba(83, 185, 124, 0.6);
        }

        .start-btn,
        .stop-btn {
          background: #1b2431;
          border: 1px solid #2b3648;
          color: #e0e6ef;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .start-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .stop-btn {
          background: #2a1b1b;
          border-color: #3c2525;
          color: #f1b7b7;
        }

        .monitoring-tabs {
          display: flex;
          gap: 8px;
        }

        .tab-btn {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #98a3b2;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
        }

        .tab-btn.active {
          background: #2b3648;
          color: #e0e6ef;
        }

        .log-pane {
          background: #0d121a;
          border: 1px solid #1f2631;
          border-radius: 12px;
          padding: 10px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: "SF Mono", "Menlo", monospace;
          font-size: 12px;
          color: #cfd6e2;
          flex: 1;
          min-height: 0;
        }

        .log-line {
          display: grid;
          grid-template-columns: 70px 80px 1fr;
          gap: 10px;
          align-items: start;
        }

        .log-line.live {
          color: #e8f6ff;
        }

        .log-time {
          color: #7d8796;
          font-size: 10px;
        }

        .log-kind {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 9px;
          color: #8b96a5;
        }

        .log-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .log-empty {
          color: #7f8a9a;
          font-size: 12px;
        }

        .monitoring-input {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          margin-top: auto;
        }

        .monitoring-textarea {
          flex: 1;
          background: #111722;
          border: 1px solid #273042;
          border-radius: 10px;
          padding: 8px 10px;
          color: #e0e6ef;
          font-size: 12px;
          resize: none;
        }

        .custom-start-textarea {
          background: #111722;
          border: 1px solid #273042;
          border-radius: 10px;
          padding: 8px 10px;
          color: #e0e6ef;
          font-size: 12px;
          resize: vertical;
        }

        .monitoring-send {
          background: #1b2431;
          border: 1px solid #2b3648;
          color: #e0e6ef;
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .monitoring-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .monitoring-empty p {
          margin: 0;
          color: #8d97a6;
          font-size: 12px;
        }

        .monitoring-error {
          color: #f1b7b7;
          background: #2a1b1b;
          border: 1px solid #3c2525;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .subagents-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          border: 1px solid #233041;
          border-radius: 14px;
          padding: 12px;
          background: #0f1520;
          min-height: 0;
        }

        .subagents-panel.collapsed {
          width: 58px;
          padding: 8px 6px;
          align-items: center;
        }

        .subagents-panel.expanded {
          width: 320px;
        }

        .monitoring-columns.subagents-only .subagents-panel.expanded {
          width: 100%;
        }

        .subagents-toggle {
          width: 100%;
          background: #141b26;
          border: 1px solid #1f2631;
          color: #98a3b2;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .subagents-panel.collapsed .subagents-toggle {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          height: 100%;
          justify-content: center;
        }

        .subagents-count {
          background: #1b2431;
          border-radius: 999px;
          padding: 2px 6px;
          font-size: 10px;
        }

        .subagents-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
          flex: 1;
        }

        .subagents-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow: auto;
          min-height: 0;
        }

        .subagent-row {
          background: #141b26;
          border: 1px solid #1f2631;
          border-radius: 10px;
          padding: 8px 10px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .subagent-row.active {
          border-color: #3b6ecc;
          background: #1a2230;
        }

        .subagent-title {
          font-size: 12px;
          font-weight: 600;
        }

        .subagent-meta {
          display: flex;
          gap: 10px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8b96a5;
        }

        .subagent-status.running {
          color: #53b97c;
        }

        .subagent-status.error {
          color: #f08b57;
        }

        .subagent-status.replied {
          color: #9db7ff;
        }

        .subagent-logs {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .subagent-stop {
          align-self: flex-end;
        }

        @media (max-width: 900px) {
          .overlay-panel {
            height: 92vh;
            padding: 16px;
          }

          .overlay-content {
            grid-template-columns: 1fr;
            grid-template-rows: minmax(0, 1fr) minmax(0, 0.6fr);
          }

          .board {
            padding: 12px;
          }
        }
      `}</style>
    </div>
  );
}
