# Web extension route registry

- Added `apps/web/src/lib/web-route-registry.tsx`.
- Core `App.tsx` now renders extension routes from registry, not literal board/projects route imports.
- `apps/web/src/extensions/*/routes.tsx` modules export `webRouteExtension` manifests with extension id, home component, and routes.
- Registry uses `import.meta.glob("../extensions/*/routes.tsx", { eager: true })`; if optional route files are absent, web build sees no entries.
- Runtime behavior remains capability-gated through `isExtensionEnabled()`.
- Verified by temporarily moving `apps/web/src/extensions` out of tree and running `pnpm build:web`; build still passed.
