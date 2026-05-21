---
name: trace-debugger
description: Debug agent execution failures and unexpected behavior by analyzing Langfuse and Inngest traces. Use when investigating agent run failures, checking traces/logs/execution history, analyzing specific run IDs or workflow executions, or after any agent execution that resulted in an error. Triggers on keywords like "trace", "run failed", "debug workflow", "Langfuse", "Inngest", "run ID", "what happened".
---

# Trace Debugger

Forensic analysis of distributed agent workflows using Langfuse and Inngest.

## Methodology

1. **Gather Context**: Extract run IDs, agent names, timestamps, error messages. If missing, ask for: run ID, approximate time, agent/workflow name.

2. **Execute Trace Commands**: Run both `langfuse` and `inngest` CLI tools for comprehensive view. See [references/cli.md](references/cli.md).

3. **Systematic Analysis**:
   - Reconstruct chronological event sequence
   - Identify where execution diverged from expected path
   - Pinpoint exact failure point (stack traces, error codes)
   - Check for: missing events, timeout patterns, state inconsistencies, API failures
   - Correlate Langfuse spans with Inngest events

4. **Root Cause Identification**:
   - Distinguish agent logic errors vs infrastructure issues
   - Check for: malformed inputs, tool call failures, state management bugs, external API problems

5. **Structured Report**:
   - **Summary**: One-line root cause
   - **Timeline**: Key events in sequence
   - **Failure Point**: Exact location with context
   - **Evidence**: Relevant log excerpts, error messages
   - **Hypothesis**: Why this happened
   - **Recommendation**: Concrete next steps

## Constraints

- NEVER speculate without trace evidence
- ALWAYS cite specific log lines or events
- If tools return errors, explain what data is unavailable
- Distinguish between confirmed facts and theories
