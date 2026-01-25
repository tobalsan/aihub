import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { fetchProjects, fetchProject, updateProject, fetchAgents } from "../api/client";
import type { ProjectListItem, ProjectDetail } from "../api/types";

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

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = frontmatter?.[key];
  return typeof value === "string" ? value : undefined;
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
  const [openMenu, setOpenMenu] = createSignal<"status" | "appetite" | "domain" | "owner" | "mode" | null>(null);

  const ownerOptions = createMemo(() => {
    const names = (agents() ?? []).map((agent) => agent.name);
    return ["Thinh", ...names.filter((name) => name !== "Thinh")];
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
      setOpenMenu(null);
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

  const openDetail = (id: string) => {
    navigate(`/projects/${id}`);
  };

  const closeDetail = () => {
    navigate("/projects");
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
                </div>
                <h3>Monitoring</h3>
                <p>Session pane coming soon.</p>
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
          width: min(1200px, 96vw);
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
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
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
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .detail-body {
          flex: 1;
          overflow: auto;
          background: #0c111a;
          border-radius: 12px;
          border: 1px solid #202836;
          padding: 12px;
          color: #d4dbe5;
          font-size: 14px;
          line-height: 1.5;
        }

        .detail-body :is(h1, h2, h3) {
          margin: 0.6em 0 0.4em;
        }

        .detail-body p {
          margin: 0 0 0.8em;
        }

        .monitoring h3 {
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: #8d97a6;
        }

        .monitoring p {
          color: #aab2bf;
          font-size: 14px;
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
