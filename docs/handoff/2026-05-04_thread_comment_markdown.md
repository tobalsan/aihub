# Thread Comment Markdown

Implemented PRO-240-S14.

- Project lifecycle Thread comments in `BoardProjectDetailPage` now render through the shared sanitized markdown renderer.
- Slice Thread content in `SliceDetailPage` now renders as sanitized markdown instead of raw preformatted text.
- Thread links use the Board convention: `target="_blank"` and `rel="noopener noreferrer"`.
- Added regression coverage for markdown formatting, link attrs, and script sanitization on both project and slice thread surfaces.
- Also fixed lint errors surfaced by `pnpm lint` in nearby/unrelated files without suppression comments.

Validation:

- `pnpm test:web`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build:web`
