# Agent container concurrency fix

## Context

Production-readiness concurrency check for CloudiHub-style usage exposed failures when 10 real agent runs started simultaneously. The run used `AIHUB_HOME=/Users/thinh/code/algodyn/cloudi-fi/cloudihub/config` and distributed requests across `sally`, `henry`, `casey`, and `roddy`.

## Finding

Before the fix, 10 simultaneous `aihub send` runs produced 7 successes and 3 failures. The failures happened before normal LLM completion and matched Docker container-name collisions.

The old container name format used `Date.now()`:

```ts
`aihub-agent-${agent.id}-${Date.now()}`
```

Concurrent launches for the same agent could share the same millisecond and collide on Docker `--name`.

## Change

Updated `apps/gateway/src/agents/container.ts` to use a UUID-suffixed container name:

```ts
`aihub-agent-${agentId}-${randomUUID()}`
```

Updated the matching unit expectation in `apps/gateway/src/agents/container.test.ts` to assert the UUID form.

Updated `docs/llms.md` with the container naming behavior.

## Verification

Reran the same 10 simultaneous real-agent benchmark after the fix:

```text
total=10
ok=10
fail=0
wall=5.7s
p50=5.1s
p95=5.6s
max=5.6s
```

No Docker container-name collision failures occurred.
