# CLI Tool Reference

Run `<tool> --help` for full list of commands and options.

## Inngest CLI

List recent events:
```bash
inngest events --since 15m
inngest events --name agent.response.complete
```

Get event details:
```bash
inngest event <internal_id>
```

Get function runs for an event:
```bash
inngest runs --event <internal_id>
```

Get run details:
```bash
inngest run <run_id>
```

## Langfuse CLI

**Important**: Always set `--env-file env/orchestrator.env` for every command.

Fetch traces:
```bash
langfuse --env-file env/orchestrator.env traces
```

Get specific trace:
```bash
langfuse --env-file env/orchestrator.env trace <session_id>
```

Get sessions:
```bash
langfuse --env-file env/orchestrator.env sessions --since 15m
langfuse --env-file env/orchestrator.env sessions --from 1h --env production
```

Get specific session:
```bash
langfuse --env-file env/orchestrator.env session <session_id>
```

Get most recent session:
```bash
langfuse --env-file env/orchestrator.env session --last
```

Command reference:
```bash
langfuse docs
```
