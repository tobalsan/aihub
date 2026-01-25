# Headless Session Resumption - Quick Summary

## Claude Code
```bash
# Continue last
claude -c -p "next step"

# Resume specific
claude -r <session_id> -p "continue"

# Get session ID
session=$(claude -p "task" --output-format json | jq -r '.session_id')
```

**Storage:** `~/.claude/sessions/`

---

## Gemini CLI
```bash
# Resume by UUID
gemini --resume <uuid> --prompt "continue"

# Get session ID from streaming JSON (init event)
```

**Limitation:** No direct `--session-id` flag documented. Must use `--resume <uuid>`.

**Storage:** `~/.gemini/tmp/<project_hash>/chats/`

---

## Codex
```bash
# Official CLI: NO headless session resumption ❌

# Community fork only:
codex exec --resume <session-id>
```

**Storage:** `~/.codex/sessions/YYYY/MM/DD/*.jsonl`

---

## Droid (Factory)
```bash
# Resume (prompt required)
droid exec --session-id <id> "continue"

# Get session ID
session=$(droid exec --output-format json "task" | jq -r '.session_id')
```

**Storage:** Not documented

---

## Bottom Line

| Tool | Headless Resume Command | Session ID Extraction | Official Support |
|------|------------------------|----------------------|------------------|
| **Claude Code** | `claude -r <id> -p "..."` | `--output-format json` | ✅ Yes |
| **Droid** | `droid exec -s <id> "..."` | `--output-format json` | ✅ Yes |
| **Gemini** | `gemini --resume <uuid> --prompt "..."` | Streaming JSON | ⚠️ Partial |
| **Codex** | N/A | `.jsonl` files | ❌ No (fork only) |
