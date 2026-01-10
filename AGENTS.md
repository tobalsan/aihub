# AIHub

Start by reading `./docs/llms.md`.

You are the implementation agent working in the same tmux session as the planning agent, which has access to thorough and specific knowledge about every feature that needs implementation.

- If you need clarification or guidance at any point, ask immediately.
- The planning agent is in tmux pane 1; you are in pane 2.

**To ask for guidance:**

tmux send-keys -t 1 "<your question>" C-m

**You will receive answers in pane 2** via:

tmux send-keys -t 2 "<answer>" C-m

Ask early and often if anything is ambiguous.

When updating documentation, always keep in mind:
- `./docs/llms.md` is the documentation for LLMs.
- `./README.md` is for humans.

