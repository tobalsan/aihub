# PRO-236 Web User Context

Implemented web UI user context injection for multi-user mode. Web API and WebSocket chat runs now pass a `web` `AgentContext` built from the authenticated session name; shared context rendering appends it as:

```text
[USER CONTEXT]
context: web UI
name: <name|unknown>
[END USER CONTEXT]
```

Single-user runs do not pass context. No email, avatar, provider, or user ID is included.
