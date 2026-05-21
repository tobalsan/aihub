import { Show, createSignal, onMount } from "solid-js";
import {
  endImpersonation,
  fetchImpersonationStatus,
  type ImpersonationStatus,
} from "../api/admin";

export const [impersonationStatus, setImpersonationStatus] =
  createSignal<ImpersonationStatus | null>(null);

export async function refetchImpersonationStatus(): Promise<void> {
  try {
    setImpersonationStatus(await fetchImpersonationStatus());
  } catch {
    setImpersonationStatus({ active: false });
  }
}

export function ImpersonationBanner() {
  onMount(() => {
    void refetchImpersonationStatus();
  });

  async function handleExit() {
    await endImpersonation();
    await refetchImpersonationStatus();
    location.assign("/admin/users");
  }

  return (
    <Show when={impersonationStatus()?.active ? impersonationStatus() : null}>
      {(status) => (
        <div class="impersonation-banner" role="status">
          <span>
            Viewing as {status().target.name ?? "Unnamed user"} (
            {status().target.email ?? "no email"})
          </span>
          <button type="button" onClick={() => void handleExit()}>
            Exit
          </button>
          <style>{`
            .impersonation-banner {
              position: sticky;
              top: 0;
              z-index: 1000;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 12px;
              padding: 10px 16px;
              background: #f59e0b;
              color: #111827;
              font-weight: 700;
            }

            .impersonation-banner button {
              border: 1px solid rgb(17 24 39 / 0.35);
              border-radius: 999px;
              background: rgb(255 255 255 / 0.35);
              color: inherit;
              padding: 4px 12px;
              font-weight: 700;
              cursor: pointer;
            }
          `}</style>
        </div>
      )}
    </Show>
  );
}
