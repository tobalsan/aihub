# AIHub

Start by reading `./docs/llms.md`.

Ask early and often if anything is ambiguous.

After a code update, make sure to keep documentation up to date, mainly:
- @`./docs/llms.md` is the documentation for LLMs.
- @`./README.md` is for humans.
- write handoff updates per session under `./docs/handoff/<YYYY-mm-dd>_<short_descriptive_title_for_session>.md` to track codebase progress without creating a single large shared file.

Tests: use scoped scripts for package-level runs: `pnpm test:web`, `pnpm test:gateway`, `pnpm test:shared`, `pnpm test:cli`. For single tests, use an exact file path: `pnpm exec vitest run <path-to-test-file>`. Avoid `pnpm test -- <path>` here; positional Vitest filters are unreliable in this repo. Run tests serially (one command at a time); parallel runs can cause transient `ENOENT` in subagent runner tests. Run `pnpm install` if `node_modules` is missing.
