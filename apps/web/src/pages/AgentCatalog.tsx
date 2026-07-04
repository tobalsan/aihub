import { createResource, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchPool } from "../api";

function isEmoji(str: string): boolean {
  return /^\p{Emoji}/u.test(str) && str.length <= 4;
}

export function AgentCatalog() {
  const [agents] = createResource(fetchPool);

  return (
    <div class="agent-catalog">
      <h1 class="catalog-heading">Agents</h1>

      <Show when={agents.loading}>
        <div class="loading">Loading agents...</div>
      </Show>

      <Show when={agents.error}>
        <div class="error">Failed to load agents</div>
      </Show>

      <Show when={agents()}>
        <div class="catalog-grid">
          <For each={agents()}>
            {(agent) => (
              <div class="catalog-card">
                <Show when={agent.avatar}>
                  {(avatar) => (
                    <div class="catalog-avatar">
                      {isEmoji(avatar()) ? (
                        <span class="avatar-emoji">{avatar()}</span>
                      ) : (
                        <img src={avatar()} alt={agent.name} class="avatar-img" />
                      )}
                    </div>
                  )}
                </Show>
                <div class="catalog-name">{agent.name}</div>
                <Show when={agent.role}>
                  <div class="catalog-role">{agent.role}</div>
                </Show>
                <Show when={agent.description}>
                  <div class="catalog-description">{agent.description}</div>
                </Show>
                <div class="catalog-divider" />
                <A href={`/chat/${agent.id}`} class="catalog-chat-link">
                  Chat
                </A>
              </div>
            )}
          </For>
        </div>
      </Show>

      <style>{`
        .agent-catalog {
          padding: 24px;
        }

        .catalog-heading {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 20px;
        }

        .loading, .error {
          padding: 24px;
          text-align: center;
          color: var(--text-tertiary);
        }

        .error {
          color: #e55;
        }

        .catalog-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
        }

        .catalog-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          height: 100%;
          padding: 20px 16px;
          background: var(--bg-surface);
          border: 1px solid var(--scrollbar-thumb);
          border-radius: 12px;
        }

        .catalog-avatar {
          width: calc(100% + 32px);
          aspect-ratio: 1 / 1;
          border-radius: 12px 12px 0 0;
          background: var(--bg-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          margin: -20px -16px 12px -16px;
        }

        .avatar-emoji {
          font-size: 96px;
          line-height: 1;
        }

        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .catalog-name {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .catalog-role {
          font-size: 13px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }

        .catalog-description {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: 6px;
        }

        .catalog-divider {
          width: 100%;
          height: 1px;
          background: var(--border-default);
          margin: 14px 0;
          margin-top: auto;
        }

        .catalog-chat-link {
          display: inline-block;
          padding: 8px 20px;
          border-radius: 8px;
          background: var(--bg-raised);
          color: var(--text-primary);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.2s ease;
        }

        .catalog-chat-link:hover {
          background: var(--border-default);
        }

        @media (max-width: 768px) {
          .catalog-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          }
        }
      `}</style>
    </div>
  );
}
