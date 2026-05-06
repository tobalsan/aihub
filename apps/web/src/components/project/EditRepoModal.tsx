import { createSignal, onCleanup, onMount } from "solid-js";
import type { ProjectDetail } from "../../api/types";
import type { ToastVariant } from "../ui/Toast";

type RepoSaveResult = Pick<ProjectDetail, "frontmatter" | "repoValid">;

type EditRepoModalProps = {
  initialRepo: string;
  onClose: () => void;
  onSave: (repo: string) => Promise<RepoSaveResult>;
  showToast: (message: string, variant: ToastVariant) => void;
  getErrorMessage?: (project: RepoSaveResult) => string;
};

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function EditRepoModal(props: EditRepoModalProps) {
  const [repo, setRepo] = createSignal(props.initialRepo);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let panelRef: HTMLElement | undefined;

  onMount(() => {
    inputRef?.focus();

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
    const nextRepo = repo();
    setSaving(true);
    setError(null);
    try {
      const updated = await props.onSave(nextRepo);
      if (nextRepo.trim() === "" || updated.repoValid) {
        props.showToast(
          nextRepo.trim() === "" ? "Repo cleared" : `Repo set to ${nextRepo}`,
          "success"
        );
        props.onClose();
        return;
      }
      setError(props.getErrorMessage?.(updated) || "Path not found");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save repo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      class="edit-repo-modal-overlay"
      data-testid="edit-repo-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={(el) => (panelRef = el)}
        class="edit-repo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-repo-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header class="edit-repo-modal__header">
          <h2 id="edit-repo-title">Edit repo</h2>
        </header>
        <div class="edit-repo-modal__body">
          <label class="edit-repo-modal__label" for="edit-repo-input">
            Repository path
          </label>
          <input
            ref={(el) => (inputRef = el)}
            id="edit-repo-input"
            class="edit-repo-modal__input"
            type="text"
            value={repo()}
            disabled={saving()}
            onInput={(event) => setRepo(event.currentTarget.value)}
          />
          {error() ? <p class="edit-repo-modal__error">⚠ {error()}</p> : null}
        </div>
        <footer class="edit-repo-modal__footer">
          <button
            type="button"
            class="edit-repo-modal__button"
            disabled={saving()}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            class="edit-repo-modal__button edit-repo-modal__button--primary"
            disabled={saving()}
            onClick={() => void handleSave()}
          >
            {saving() ? "Saving…" : "Save"}
          </button>
        </footer>
      </section>

      <style>{`
        .edit-repo-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.45);
        }

        .edit-repo-modal {
          width: min(460px, 100%);
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: var(--bg-surface);
          color: var(--text-primary);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
          overflow: hidden;
        }

        .edit-repo-modal__header {
          padding: 16px 18px 10px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .edit-repo-modal__header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 650;
        }

        .edit-repo-modal__body {
          padding: 16px 18px;
        }

        .edit-repo-modal__label {
          display: block;
          margin-bottom: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
        }

        .edit-repo-modal__input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: var(--bg-overlay);
          color: var(--text-primary);
          padding: 8px 10px;
          font-size: 13px;
        }

        .edit-repo-modal__input:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }

        .edit-repo-modal__error {
          margin: 8px 0 0;
          color: var(--color-danger, #e05252);
          font-size: 12px;
        }

        .edit-repo-modal__footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 18px 16px;
        }

        .edit-repo-modal__button {
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: var(--bg-overlay);
          color: var(--text-primary);
          padding: 7px 12px;
          font-size: 13px;
          cursor: pointer;
        }

        .edit-repo-modal__button--primary {
          border-color: rgba(34, 197, 94, 0.45);
          background: color-mix(in srgb, #22c55e 18%, var(--bg-overlay));
        }

        .edit-repo-modal__button:disabled {
          cursor: not-allowed;
          opacity: 0.62;
        }
      `}</style>
    </div>
  );
}
