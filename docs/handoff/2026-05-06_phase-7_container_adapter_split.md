# Phase 7 Container Adapter Split

Split `apps/gateway/src/sdk/container/adapter.ts` into focused internal modules while preserving `getContainerAdapter()` as the public composition point.

- `launch-spec.ts`: Docker launch args, runtime dirs, IPC cleanup, and upload copying/remapping.
- `protocol.ts`: shared marker aliases, stderr filtering, output parsing, and incremental stdout decoding.
- `input-builder.ts`: `ContainerInput` construction, gateway URL, OneCLI URL, and model sanitization.
- `file-output.ts`: `/workspace/data` validation, outbound media copy/metadata registration, and stream/history events.
- `tool-bridge.ts`: extension prompt and tool metadata serialization for container runs.

Moved container protocol marker constants to `packages/shared/src/container-protocol.ts` and updated the runner entrypoint to import them through `@aihub/shared`.

Added focused Vitest coverage for each new gateway module plus kept the existing adapter behavior tests passing.
