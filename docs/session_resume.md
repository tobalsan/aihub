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

## Pi CLI
```bash
# Resume by session file path
pi --mode json --session <session_file> "continue"
```

**Storage:** session file path supplied to `--session`

---

## Codex
```bash
# Official CLI: NO headless session resumption ❌

# Community fork only:
codex exec --resume <session-id>
```

**Storage:** `~/.codex/sessions/YYYY/MM/DD/*.jsonl`

---

## Bottom Line

| Tool | Headless Resume Command | Session ID Extraction | Official Support |
|------|------------------------|----------------------|------------------|
| **Claude Code** | `claude -r <id> -p "..."` | `--output-format json` | ✅ Yes |
| **Pi** | `pi --mode json --session <file> "..."` | session file path | ✅ Yes |
| **Codex** | N/A | `.jsonl` files | ❌ No (fork only) |
