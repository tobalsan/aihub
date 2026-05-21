# Container attachment paths

- Investigated xls/xlsx uploads reaching media + container upload dirs but not visible to agents.
- Root cause: container runner only passed image attachments to Pi prompt options; non-image files depended entirely on gateway text extraction. If extraction was absent/failed, model saw no file/path.
- Updated container runner to append non-image attachment names, MIME, sizes, and `/workspace/uploads/...` paths to the prompt.
- Updated gateway attachment text extraction to warn on extraction failures and include a fallback marker/path instead of silently dropping docs.
- Expanded Slack inbound allowlist to include `.doc` and `.xls` in addition to `.docx`/`.xlsx`.
- Added runner test covering non-image attachment path injection and Slack helper coverage for doc/xls MIME mapping.

Verification:
- `pnpm exec vitest run container/agent-runner/src/__tests__/runner.test.ts`
- `pnpm exec vitest run packages/extensions/slack/src/utils/attachments.test.ts`
- `pnpm test:gateway`
