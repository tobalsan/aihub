import { Show, createSignal } from "solid-js";

type ThreadReplyStatus = "idle" | "submitting" | "mentions";

type ThreadReplyInputProps = {
  disabled?: boolean;
  status: ThreadReplyStatus;
  error?: string | null;
  onSubmit: (message: string) => Promise<boolean>;
};

export function ThreadReplyInput(props: ThreadReplyInputProps) {
  const [message, setMessage] = createSignal("");

  const submit = async (event: Event) => {
    event.preventDefault();
    if (props.disabled || props.status !== "idle") return;
    const next = message().trim();
    if (!next) return;
    const ok = await props.onSubmit(next);
    if (ok) setMessage("");
  };

  return (
    <section class="thread-reply">
      <h3>Reply</h3>
      <form class="thread-reply-form" onSubmit={submit}>
        <textarea
          class="thread-reply-textarea"
          rows={3}
          placeholder="Reply to this thread..."
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          disabled={props.disabled || props.status !== "idle"}
        />
        <div class="thread-reply-actions">
          <Show when={props.status !== "idle"}>
            <div class="thread-reply-thinking" aria-live="polite">
              <div class="thread-thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span>{props.status === "submitting" ? "Posting..." : "Processing mentions..."}</span>
            </div>
          </Show>
          <button
            class="thread-reply-btn"
            type="submit"
            disabled={props.disabled || props.status !== "idle" || message().trim().length === 0}
          >
            Send
          </button>
        </div>
      </form>
      <Show when={props.error}>{(value) => <div class="thread-reply-error">{value()}</div>}</Show>
    </section>
  );
}
