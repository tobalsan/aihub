import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

type ApprovalUser = {
  id?: string;
  approved?: boolean | null;
};

type MeResponse = {
  user?: ApprovalUser | null;
};

export function usePendingApprovalRefresh(user: Accessor<ApprovalUser | null>) {
  const [approved, setApproved] = createSignal(false);
  let lastUserId: string | null = null;

  async function refresh() {
    if (user()?.approved !== false) return;
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) return;
      const payload = (await response.json()) as MeResponse;
      if (payload.user?.approved === true) {
        setApproved(true);
      }
    } catch {
      // Keep pending UI; next poll/focus retries.
    }
  }

  createEffect(() => {
    const userId = user()?.id ?? null;
    if (userId !== lastUserId) {
      lastUserId = userId;
      setApproved(false);
    }
  });

  createEffect(() => {
    if (user()?.approved !== false || approved()) return;

    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    onCleanup(() => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    });
  });

  return approved;
}
