import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  createTeam,
  deleteTeam,
  fetchTeams,
  updateTeam,
  type Team,
} from "../api/teams";
import { useSession } from "../auth/client";

const STAFF_ROLES = ["admin", "superadmin"];

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.some((r) => STAFF_ROLES.includes(r));
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

// Curated palette + Font Awesome icons for the pickers. Both are optional; the
// backend supplies grey / fa-users defaults when left unset.
const COLOR_OPTIONS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

const ICON_OPTIONS = [
  "fa-solid fa-users",
  "fa-solid fa-user-group",
  "fa-solid fa-people-group",
  "fa-solid fa-rocket",
  "fa-solid fa-flask",
  "fa-solid fa-gear",
  "fa-solid fa-code",
  "fa-solid fa-shield-halved",
  "fa-solid fa-bolt",
  "fa-solid fa-star",
  "fa-solid fa-fire",
  "fa-solid fa-heart",
  "fa-solid fa-briefcase",
  "fa-solid fa-chart-line",
  "fa-solid fa-palette",
  "fa-solid fa-bug",
  "fa-solid fa-cloud",
  "fa-solid fa-globe",
];

type TeamDraft = {
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
};

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function TeamModal(props: {
  team: Team | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = createSignal(props.team?.name ?? "");
  const [description, setDescription] = createSignal(
    props.team?.description ?? ""
  );
  const [color, setColor] = createSignal<string | null>(
    props.team?.color ?? null
  );
  const [icon, setIcon] = createSignal<string | null>(props.team?.icon ?? null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let panelRef: HTMLElement | undefined;
  let nameRef: HTMLInputElement | undefined;

  onMount(() => {
    nameRef?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef) return;
      const items = focusableElements(panelRef);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  const handleSave = async () => {
    if (saving()) return;
    const trimmedName = name().trim();
    if (trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const draft: TeamDraft = {
      name: trimmedName,
      description: description().trim(),
      color: color(),
      icon: icon(),
    };
    try {
      if (props.team) {
        await updateTeam(props.team.id, draft);
      } else {
        await createTeam(draft);
      }
      props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save team.");
      setSaving(false);
    }
  };

  return (
    <div
      class="team-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={(el) => (panelRef = el)}
        class="team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header class="team-modal__header">
          <h2 id="team-modal-title">
            {props.team ? "Edit team" : "Create team"}
          </h2>
        </header>
        <div class="team-modal__body">
          <label class="team-field">
            <span class="team-field__label">Name</span>
            <input
              ref={(el) => (nameRef = el)}
              class="team-field__input"
              type="text"
              value={name()}
              disabled={saving()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label class="team-field">
            <span class="team-field__label">Description</span>
            <textarea
              class="team-field__input team-field__textarea"
              rows={3}
              value={description()}
              disabled={saving()}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
          <div class="team-field">
            <span class="team-field__label">Color (optional)</span>
            <div class="team-swatches">
              <For each={COLOR_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class="team-swatch"
                    classList={{ "team-swatch--active": color() === option }}
                    style={{ background: option }}
                    aria-label={`Color ${option}`}
                    aria-pressed={color() === option}
                    disabled={saving()}
                    onClick={() =>
                      setColor(color() === option ? null : option)
                    }
                  />
                )}
              </For>
            </div>
          </div>
          <div class="team-field">
            <span class="team-field__label">Icon (optional)</span>
            <div class="team-icons">
              <For each={ICON_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class="team-icon-choice"
                    classList={{
                      "team-icon-choice--active": icon() === option,
                    }}
                    aria-label={option}
                    aria-pressed={icon() === option}
                    disabled={saving()}
                    onClick={() => setIcon(icon() === option ? null : option)}
                  >
                    <i class={option} aria-hidden="true" />
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={error()}>
            {(message) => <p class="team-modal__error">⚠ {message()}</p>}
          </Show>
        </div>
        <footer class="team-modal__footer">
          <button
            type="button"
            class="team-button"
            disabled={saving()}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            class="team-button team-button--primary"
            disabled={saving()}
            onClick={() => void handleSave()}
          >
            {saving() ? "Saving…" : props.team ? "Save" : "Create"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DeleteTeamDialog(props: {
  team: Team;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleDelete = async () => {
    if (deleting()) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTeam(props.team.id);
      props.onDeleted();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to delete team."
      );
      setDeleting(false);
    }
  };

  return (
    <div
      class="team-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        class="team-modal team-modal--danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="team-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header class="team-modal__header">
          <h2 id="team-delete-title">Delete “{props.team.name}”?</h2>
        </header>
        <div class="team-modal__body">
          <p class="team-delete-warning">
            This permanently removes the team. Members and agents assigned to it
            will be left without a team. This cannot be undone.
          </p>
          <Show when={error()}>
            {(message) => <p class="team-modal__error">⚠ {message()}</p>}
          </Show>
        </div>
        <footer class="team-modal__footer">
          <button
            type="button"
            class="team-button"
            disabled={deleting()}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            class="team-button team-button--danger"
            disabled={deleting()}
            onClick={() => void handleDelete()}
          >
            {deleting() ? "Deleting…" : "Delete team"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function Teams() {
  const session = useSession();
  const [teams, { refetch }] = createResource(fetchTeams);
  const [modalTeam, setModalTeam] = createSignal<Team | null | undefined>(
    undefined
  );
  const [deleteTarget, setDeleteTarget] = createSignal<Team | null>(null);

  const isAdmin = createMemo(() =>
    hasAdminRole((session().data?.user as { role?: string } | undefined)?.role)
  );

  const sortedTeams = createMemo(() =>
    [...(teams() ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  );

  const closeModal = () => setModalTeam(undefined);
  const onSaved = () => {
    closeModal();
    void refetch();
  };

  return (
    <div class="teams-page">
      <header class="teams-header">
        <div>
          <h1 class="teams-heading">Teams</h1>
          <p class="teams-subtext">
            Organize agents and users into teams.
          </p>
        </div>
        <Show when={isAdmin()}>
          <button
            type="button"
            class="team-button team-button--primary"
            onClick={() => setModalTeam(null)}
          >
            <i class="fa-solid fa-plus" aria-hidden="true" /> New team
          </button>
        </Show>
      </header>

      <Show
        when={!teams.loading}
        fallback={<div class="teams-empty">Loading teams…</div>}
      >
        <Show
          when={sortedTeams().length > 0}
          fallback={<div class="teams-empty">No teams yet.</div>}
        >
          <div class="teams-grid">
            <For each={sortedTeams()}>
              {(team) => (
                <article class="team-card">
                  <div
                    class="team-card__icon"
                    style={{ background: team.color }}
                  >
                    <i class={team.icon} aria-hidden="true" />
                  </div>
                  <div class="team-card__body">
                    <h2 class="team-card__name">{team.name}</h2>
                    <Show when={team.description}>
                      <p class="team-card__description">{team.description}</p>
                    </Show>
                  </div>
                  <Show when={isAdmin()}>
                    <div class="team-card__actions">
                      <button
                        type="button"
                        class="team-button"
                        onClick={() => setModalTeam(team)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="team-button team-button--danger-text"
                        onClick={() => setDeleteTarget(team)}
                      >
                        Delete
                      </button>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={modalTeam() !== undefined}>
        <TeamModal
          team={modalTeam() ?? null}
          onClose={closeModal}
          onSaved={onSaved}
        />
      </Show>

      <Show when={deleteTarget()}>
        {(team) => (
          <DeleteTeamDialog
            team={team()}
            onClose={() => setDeleteTarget(null)}
            onDeleted={() => {
              setDeleteTarget(null);
              void refetch();
            }}
          />
        )}
      </Show>

      <style>{`
        .teams-page {
          padding: 24px;
        }

        .teams-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
        }

        .teams-heading {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 8px;
        }

        .teams-subtext {
          font-size: 14px;
          color: var(--text-tertiary);
          margin: 0;
        }

        .teams-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
        }

        .team-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 18px;
          border: 1px solid var(--border-default);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
        }

        .team-card__icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          color: #fff;
          font-size: 18px;
        }

        .team-card__name {
          margin: 0 0 4px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .team-card__description {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .team-card__actions {
          display: flex;
          gap: 8px;
          margin-top: auto;
        }

        .teams-empty {
          padding: 24px;
          border: 1px solid var(--border-default);
          border-radius: 14px;
          color: var(--text-secondary);
          background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
        }

        .team-button {
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: var(--bg-overlay);
          color: var(--text-primary);
          padding: 7px 12px;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .team-button--primary {
          border-color: rgba(34, 197, 94, 0.45);
          background: color-mix(in srgb, #22c55e 18%, var(--bg-overlay));
        }

        .team-button--danger {
          border-color: rgba(239, 68, 68, 0.5);
          background: color-mix(in srgb, #ef4444 20%, var(--bg-overlay));
        }

        .team-button--danger-text {
          color: var(--color-danger, #e05252);
        }

        .team-button:disabled {
          cursor: not-allowed;
          opacity: 0.62;
        }

        .team-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.45);
        }

        .team-modal {
          width: min(480px, 100%);
          max-height: calc(100vh - 48px);
          overflow-y: auto;
          border: 1px solid var(--border-default);
          border-radius: 10px;
          background: var(--bg-surface);
          color: var(--text-primary);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
        }

        .team-modal__header {
          padding: 16px 18px 10px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .team-modal__header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 650;
        }

        .team-modal__body {
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .team-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .team-field__label {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
        }

        .team-field__input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: var(--bg-overlay);
          color: var(--text-primary);
          padding: 8px 10px;
          font-size: 13px;
          font-family: inherit;
        }

        .team-field__textarea {
          resize: vertical;
        }

        .team-swatches {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .team-swatch {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: 2px solid transparent;
          cursor: pointer;
          padding: 0;
        }

        .team-swatch--active {
          border-color: var(--text-primary);
          box-shadow: 0 0 0 2px var(--bg-surface);
        }

        .team-icons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .team-icon-choice {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--border-default);
          background: var(--bg-overlay);
          color: var(--text-primary);
          cursor: pointer;
          display: grid;
          place-items: center;
          font-size: 15px;
        }

        .team-icon-choice--active {
          border-color: var(--text-primary);
          background: color-mix(in srgb, #3b82f6 20%, var(--bg-overlay));
        }

        .team-modal__error {
          margin: 0;
          color: var(--color-danger, #e05252);
          font-size: 12px;
        }

        .team-modal__footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 18px 16px;
        }

        .team-delete-warning {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
