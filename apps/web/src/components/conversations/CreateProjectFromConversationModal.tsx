import { Show, createEffect, createSignal } from "solid-js";
import { createProjectFromConversation } from "../../api/client";
import type { ConversationDetail } from "../../api/types";

type CreateProjectFromConversationModalProps = {
  open: boolean;
  conversation: ConversationDetail | null;
  onClose: () => void;
  onCreated: (projectId: string) => void;
};

export function CreateProjectFromConversationModal(
  props: CreateProjectFromConversationModalProps
) {
  const [title, setTitle] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open || !props.conversation) return;
    setTitle(props.conversation.title);
    setError(null);
  });

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!props.conversation || submitting()) return;

    setSubmitting(true);
    setError(null);
    const result = await createProjectFromConversation(props.conversation.id, {
      title: title().trim() || props.conversation.title,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    props.onCreated(result.data.id);
    props.onClose();
  };

  return (
    <Show when={props.open && props.conversation}>
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Create project from conversation">
        <div class="overlay-backdrop" onClick={props.onClose} />
        <form class="conversation-create-modal" onSubmit={submit}>
          <h3>Create Project From Conversation</h3>
          <label>
            Title
            <input
              type="text"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder="Project title"
            />
          </label>
          <div class="modal-hint">Status will be set to shaping.</div>
          <Show when={error()}>{(message) => <div class="modal-error">{message()}</div>}</Show>
          <div class="modal-actions">
            <button type="button" class="secondary" onClick={props.onClose} disabled={submitting()}>
              Cancel
            </button>
            <button type="submit" class="primary" disabled={submitting()}>
              {submitting() ? "Creating..." : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
