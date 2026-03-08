import { For, Show, createMemo, createResource } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchAreas, fetchProjects, updateArea } from "../api/client";
import type { Area, ProjectListItem } from "../api/types";
import { AreaCard, STATUS_META, type AreaStats } from "./AreaCard";

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = frontmatter?.[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeStatus(
  raw?: string
): (typeof STATUS_META)[number]["id"] | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_META.some((entry) => entry.id === normalized)
    ? (normalized as (typeof STATUS_META)[number]["id"])
    : null;
}

function createEmptyStats(): AreaStats {
  return {
    total: 0,
    statuses: {
      in_progress: 0,
      review: 0,
      shaping: 0,
      todo: 0,
      maybe: 0,
      not_now: 0,
      done: 0,
    },
  };
}

function applyProjectToStats(stats: AreaStats, project: ProjectListItem): void {
  const status = normalizeStatus(
    getFrontmatterString(project.frontmatter, "status")
  );
  stats.total += 1;
  if (status) stats.statuses[status] += 1;
}

export function AreasOverview() {
  const navigate = useNavigate();
  const [areas, { mutate: mutateAreas }] = createResource(fetchAreas);
  const [projects] = createResource(fetchProjects);

  const sortedAreas = createMemo(() =>
    [...(areas() ?? [])].sort((a, b) => {
      const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.title.localeCompare(b.title);
    })
  );

  const stats = createMemo(() => {
    const byArea = new Map<string, AreaStats>();
    const allProjects = createEmptyStats();
    for (const area of sortedAreas()) {
      byArea.set(area.id, createEmptyStats());
    }
    for (const project of projects() ?? []) {
      applyProjectToStats(allProjects, project);
      const areaId = getFrontmatterString(project.frontmatter, "area");
      if (!areaId) continue;
      const areaStats = byArea.get(areaId);
      if (areaStats) {
        applyProjectToStats(areaStats, project);
      }
    }
    return { byArea, allProjects };
  });

  const loadError = createMemo(() => {
    const current = areas.error ?? projects.error;
    if (!current) return null;
    return current instanceof Error ? current.message : "Failed to load data.";
  });

  const saveArea = async (id: string, patch: Partial<Area>): Promise<void> => {
    const updated = await updateArea(id, patch);
    mutateAreas((current) =>
      (current ?? []).map((area) => (area.id === id ? updated : area))
    );
  };

  return (
    <main class="areas-page">
      <header class="areas-header">
        <h1>Areas</h1>
        <p>Select an area to open its kanban, or jump to all projects.</p>
      </header>

      <Show when={loadError()}>
        <div class="areas-error">{loadError()}</div>
      </Show>

      <Show when={areas.loading || projects.loading}>
        <div class="areas-loading">Loading areas...</div>
      </Show>

      <Show when={(sortedAreas().length > 0 || !areas.loading) && !loadError()}>
        <div class="areas-grid">
          <button
            class="area-card all-projects-card"
            type="button"
            onClick={() => navigate("/projects")}
          >
            <div class="area-card-top">
              <span class="all-projects-title">All Projects</span>
            </div>
            <div class="area-repo">All areas combined</div>
            <div class="area-total">{stats().allProjects.total} projects</div>
            <div class="area-statuses">
              <For each={STATUS_META}>
                {(status) => (
                  <Show when={stats().allProjects.statuses[status.id] > 0}>
                    <span
                      class="area-status-chip"
                      style={{ "--status-color": status.color }}
                    >
                      {status.label}: {stats().allProjects.statuses[status.id]}
                    </span>
                  </Show>
                )}
              </For>
              <Show when={stats().allProjects.total === 0}>
                <span class="area-status-empty">No projects yet</span>
              </Show>
            </div>
          </button>

          <For each={sortedAreas()}>
            {(area) => (
              <AreaCard
                area={area}
                stats={stats().byArea.get(area.id) ?? createEmptyStats()}
                onSave={saveArea}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={!areas.loading && sortedAreas().length === 0 && !loadError()}>
        <div class="areas-empty">
          <h2>Create your first area</h2>
          <p>No area files found yet in `.areas/`.</p>
        </div>
      </Show>

      <style>{`
        .areas-page {
          height: 100%;
          overflow: auto;
          background: var(--bg-inset);
          color: var(--text-primary);
          padding: 24px 20px 36px;
          font-family: "Adwaita Sans", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        }

        .areas-header h1 {
          margin: 0;
          font-size: 26px;
          letter-spacing: -0.02em;
        }

        .areas-header p {
          margin: 6px 0 0;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .areas-error,
        .areas-loading {
          margin-top: 14px;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .areas-grid {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 14px;
        }

        .area-card {
          border: 1px solid var(--border-subtle);
          border-left: 5px solid var(--area-color, #3b82f6);
          border-radius: 14px;
          background: var(--bg-surface);
          padding: 14px;
          text-align: left;
        }

        .all-projects-card {
          --area-color: #4f46e5;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease;
        }

        .all-projects-card:hover {
          transform: translateY(-1px);
          border-color: var(--mix-col-border);
        }

        .area-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .area-title-link,
        .all-projects-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          text-decoration: none;
          line-height: 1.2;
        }

        .area-title-link:hover {
          text-decoration: underline;
        }

        .area-edit-toggle {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .area-edit-toggle:hover {
          border-color: var(--mix-col-border);
          color: var(--text-primary);
          background: var(--mix-hover-bg);
        }

        .area-edit-toggle svg {
          width: 14px;
          height: 14px;
        }

        .area-repo {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-tertiary);
          word-break: break-all;
        }

        .area-total {
          margin-top: 12px;
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .area-statuses {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .area-status-chip {
          display: inline-flex;
          align-items: center;
          border: 1px solid color-mix(in srgb, var(--status-color) 45%, transparent);
          background: color-mix(in srgb, var(--status-color) 14%, transparent);
          color: var(--text-primary);
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          line-height: 1.4;
          white-space: nowrap;
        }

        .area-status-empty {
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .area-edit-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .area-edit-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .area-edit-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .area-edit-input {
          border: 1px solid var(--border-subtle);
          background: var(--bg-input);
          color: var(--text-primary);
          border-radius: 8px;
          height: 34px;
          padding: 0 10px;
          font-size: 13px;
          outline: none;
        }

        .area-edit-input:focus {
          border-color: #3b6ecc;
        }

        .area-edit-color {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .area-edit-error {
          font-size: 12px;
          color: #dc2626;
        }

        .area-edit-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .area-edit-btn {
          border-radius: 8px;
          padding: 7px 11px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid transparent;
          cursor: pointer;
        }

        .area-edit-btn.save {
          background: #3b6ecc;
          color: white;
        }

        .area-edit-btn.save:disabled {
          opacity: 0.65;
          cursor: default;
        }

        .area-edit-btn.cancel {
          border-color: var(--border-subtle);
          color: var(--text-secondary);
          background: transparent;
        }

        .areas-empty {
          margin-top: 18px;
          border: 1px dashed var(--border-subtle);
          border-radius: 14px;
          padding: 18px;
          background: var(--bg-surface);
        }

        .areas-empty h2 {
          margin: 0;
          font-size: 17px;
        }

        .areas-empty p {
          margin: 6px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
        }

        @media (max-width: 768px) {
          .areas-page {
            padding: 18px 14px 24px;
          }

          .areas-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
