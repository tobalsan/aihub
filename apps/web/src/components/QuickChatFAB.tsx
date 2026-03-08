import type { Accessor } from "solid-js";

type QuickChatFABProps = {
  open: Accessor<boolean>;
  hasUnread: Accessor<boolean>;
  agentLabel: Accessor<string>;
  onToggle: () => void;
};

function agentInitial(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "A";
  return trimmed[0].toUpperCase();
}

export function QuickChatFAB(props: QuickChatFABProps) {
  return (
    <button
      type="button"
      class="quick-chat-fab"
      classList={{
        open: props.open(),
        pulse: props.hasUnread() && !props.open(),
      }}
      aria-label={props.open() ? "Close quick chat" : "Open quick chat"}
      aria-expanded={props.open()}
      onClick={props.onToggle}
    >
      <span class="quick-chat-fab-avatar" aria-hidden="true">
        {agentInitial(props.agentLabel())}
      </span>
      <span
        class="quick-chat-fab-dot"
        classList={{ visible: props.hasUnread() && !props.open() }}
        aria-hidden="true"
      />

      <style>{`
        .quick-chat-fab {
          position: fixed;
          right: 24px;
          bottom: 24px;
          width: 48px;
          height: 48px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--border-default) 70%, transparent);
          background: color-mix(in srgb, var(--bg-surface) 82%, #4f8cff 18%);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 800;
          box-shadow: 0 12px 28px color-mix(in srgb, var(--shadow-md) 72%, transparent);
          transition: transform 0.2s ease-out, box-shadow 0.2s ease-out, background 0.2s ease-out;
        }

        .quick-chat-fab:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 30px color-mix(in srgb, var(--shadow-md) 82%, transparent);
        }

        .quick-chat-fab:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.7);
          outline-offset: 2px;
        }

        .quick-chat-fab.open {
          background: color-mix(in srgb, var(--bg-surface) 74%, #2b5fd1 26%);
          transform: translateY(0);
        }

        .quick-chat-fab-avatar {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: color-mix(in srgb, var(--text-primary) 90%, #9ec4ff 10%);
          background: color-mix(in srgb, var(--bg-raised) 82%, #6fa0ff 18%);
          border: 1px solid color-mix(in srgb, var(--border-default) 75%, transparent);
        }

        .quick-chat-fab-dot {
          position: absolute;
          top: 9px;
          right: 9px;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #60a5fa;
          border: 1px solid color-mix(in srgb, var(--bg-surface) 85%, black 15%);
          opacity: 0;
          transform: scale(0.6);
          transition: opacity 0.2s ease-out, transform 0.2s ease-out;
        }

        .quick-chat-fab-dot.visible {
          opacity: 1;
          transform: scale(1);
        }

        .quick-chat-fab.pulse {
          animation: quick-chat-fab-pulse 1.8s ease-out infinite;
        }

        @keyframes quick-chat-fab-pulse {
          0% {
            box-shadow:
              0 12px 28px color-mix(in srgb, var(--shadow-md) 72%, transparent),
              0 0 0 0 rgba(96, 165, 250, 0.4);
          }
          70% {
            box-shadow:
              0 12px 28px color-mix(in srgb, var(--shadow-md) 72%, transparent),
              0 0 0 12px rgba(96, 165, 250, 0);
          }
          100% {
            box-shadow:
              0 12px 28px color-mix(in srgb, var(--shadow-md) 72%, transparent),
              0 0 0 0 rgba(96, 165, 250, 0);
          }
        }

        @media (max-width: 768px) {
          .quick-chat-fab {
            right: 16px;
            bottom: 88px;
          }
        }
      `}</style>
    </button>
  );
}
