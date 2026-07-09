import type { JSX } from "solid-js";

export default function AdminLayout(props: {
  title: string;
  description: string;
  children?: JSX.Element;
}) {
  return (
    <>
      <section class="admin-page">
        <header class="admin-page-header">
          <div>
            <p class="admin-page-eyebrow">Admin</p>
            <h1>{props.title}</h1>
            <p>{props.description}</p>
          </div>
        </header>
        <div class="admin-page-body">{props.children}</div>
      </section>
      <style>{`
        .admin-page {
          height: 100%;
          overflow: auto;
          padding: 28px;
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--accent, #60a5fa) 10%, transparent), transparent 24%),
            var(--bg-primary);
        }

        .admin-page-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
        }

        .admin-page-eyebrow {
          margin: 0 0 8px;
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .admin-page-header h1 {
          margin: 0;
          color: var(--text-primary);
          font-size: clamp(1.6rem, 4vw, 2.2rem);
        }

        .admin-page-header p:last-child {
          margin: 8px 0 0;
          color: var(--text-secondary);
          max-width: 58ch;
        }

        .admin-page-body {
          min-height: 0;
        }

        @media (max-width: 720px) {
          .admin-page {
            padding: 20px 16px 24px;
          }

          .admin-page-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </>
  );
}
