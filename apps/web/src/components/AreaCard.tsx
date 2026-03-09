import { For, Show, createEffect, createSignal } from "solid-js";
import { A } from "@solidjs/router";
import type { Area } from "../api/types";
import { AreaEditForm, type AreaEditDraft } from "./AreaEditForm";

const STATUS_META = [
  { id: "in_progress", label: "In Progress", color: "#8a6fd1" },
  { id: "review", label: "Review", color: "#f08b57" },
  { id: "shaping", label: "Shaping", color: "#4aa3a0" },
  { id: "todo", label: "Todo", color: "#3b6ecc" },
  { id: "maybe", label: "Maybe", color: "#d2b356" },
  { id: "not_now", label: "Not now", color: "#6b6b6b" },
  { id: "done", label: "Done", color: "#53b97c" },
] as const;

type StatusId = (typeof STATUS_META)[number]["id"];

type AreaStats = {
  total: number;
  statuses: Record<StatusId, number>;
};

type AreaCardProps = {
  area: Area;
  stats: AreaStats;
  onSave: (id: string, patch: Partial<Area>) => Promise<void>;
};

function buildDraft(area: Area): AreaEditDraft {
  return {
    title: area.title,
    color: area.color,
    order: area.order === undefined ? "" : String(area.order),
    repo: area.repo ?? "",
  };
}

export function AreaCard(props: AreaCardProps) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal<AreaEditDraft>(buildDraft(props.area));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!editing()) {
      setDraft(buildDraft(props.area));
    }
  });

  const openEdit = () => {
    setDraft(buildDraft(props.area));
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
    setDraft(buildDraft(props.area));
  };

  const saveEdit = async () => {
    const title = draft().title.trim();
    const color = draft().color.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }
    if (!color) {
      setError("Color is required.");
      return;
    }
    const orderRaw = draft().order.trim();
    let order: number | undefined;
    if (orderRaw.length > 0) {
      const parsed = Number(orderRaw);
      if (!Number.isFinite(parsed)) {
        setError("Order must be a number.");
        return;
      }
      order = parsed;
    }

    setSaving(true);
    setError(null);
    try {
      await props.onSave(props.area.id, {
        title,
        color,
        order,
        repo: draft().repo.trim(),
      });
      setEditing(false);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Failed to save area.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article class="area-card" style={{ "--area-color": props.area.color }}>
      <Show
        when={!editing()}
        fallback={
          <AreaEditForm
            draft={draft()}
            saving={saving()}
            error={error()}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
            onSave={() => void saveEdit()}
            onCancel={cancelEdit}
          />
        }
      >
        <div class="area-card-top">
          <A
            class="area-title-link"
            href={`/projects?area=${encodeURIComponent(props.area.id)}`}
          >
            {props.area.title}
          </A>
          <button
            class="area-edit-toggle"
            type="button"
            onClick={openEdit}
            aria-label={`Edit ${props.area.title}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5l4 4L8 20l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
        <div class="area-repo">
          {props.area.repo?.trim() || "No repo path set"}
        </div>
        <div class="area-total">{props.stats.total} projects</div>
        <div class="area-statuses">
          <For each={STATUS_META}>
            {(status) => (
              <Show when={props.stats.statuses[status.id] > 0}>
                <span
                  class="area-status-chip"
                  style={{ "--status-color": status.color }}
                >
                  {status.label}: {props.stats.statuses[status.id]}
                </span>
              </Show>
            )}
          </For>
          <Show when={props.stats.total === 0}>
            <span class="area-status-empty">No projects yet</span>
          </Show>
        </div>
      </Show>
    </article>
  );
}

export { STATUS_META };
export type { AreaStats, StatusId };
