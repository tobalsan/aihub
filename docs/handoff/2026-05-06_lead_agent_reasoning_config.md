# Lead Agent Reasoning Config

Added `agents[].reasoning` as the primary lead-agent thinking config, with legacy `thinkLevel` kept as an alias. Runner precedence is now request/directive override, then `agent.reasoning`, then `agent.thinkLevel`; persisted `/think` session state no longer outranks config.

Validation artifacts were captured under `validation/`:
- `claude-pom-high.png` / `claude-pom-high-rerun.dom.txt`: Anthropic `reasoning: "high"` rendered a Thinking block.
- `claude-pom-off.png` / `claude-pom-off.dom.txt`: Anthropic `reasoning: "off"` rendered no Thinking block.
- `claude-pom-thinklevel-fallback.png` / `claude-pom-thinklevel-fallback.dom.txt`: legacy `thinkLevel: "high"` still rendered Thinking.
- `ws-frames.txt`: browser-side WebSocket capture with `thinking` frames for the high run.
- `sdk-thinking-level.log`: temporary gateway log excerpt showing `high`, `off`, and fallback `high` reaching `createAgentSession`.
