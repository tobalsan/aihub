# PRO-251-S01 Project Repo Edit Affordance

Implemented the project repo edit affordance in the web UI.

Changes:

- Added `EditRepoModal` with autofocus, Escape/overlay/Cancel dismissal, focus trap, in-flight disabled state, inline invalid-path error, and success toast callback.
- Lifted `ToastNotification` to `apps/web/src/components/ui/Toast.tsx` and reused it from board list and project detail surfaces.
- Added `Actions ▾ → Edit repo…` to both project detail routes:
  - `apps/web/src/components/board/BoardProjectDetailPage.tsx`
  - `apps/web/src/components/project/ProjectDetailPage.tsx`
- Added modal unit coverage and route integration assertions.

Validation:

- `pnpm exec vitest run apps/web/src/components/project/EditRepoModal.test.tsx apps/web/src/components/project/ProjectDetailPage.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm test:web`
- `pnpm typecheck`
- Playwright against `http://127.0.0.1:3001/board`; artifacts under `validation/`.

Notes:

- Runtime `.aihub` seed data was used only for Playwright validation and must not be committed.
