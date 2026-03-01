# AIHub

Start by reading `./docs/llms.md`.

Ask early and often if anything is ambiguous.

After a code update, make sure to keep documentation up to date, mainly:
- @`./docs/llms.md` is the documentation for LLMs.
- @`./README.md` is for humans.
- @`./docs/handoff.md` is to keep track of the codebase progress.

Tests: `pnpm test -- <path>` (run `pnpm install` if `node_modules` missing). Run tests serially (one command at a time); parallel runs can cause transient `ENOENT` in subagent runner tests.
