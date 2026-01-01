# TOOLS.md - Local Notes

Skills define *how* tools work. This file is for *your* specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:
- Custom way of using the skills
- Custom configurations or parameters
- Preferred voices for TTS
- Details specific to your responsibilities
- Anything environment-specific

## Examples

```markdown
### Communicating with other agents 
After some time, especially if you instructed the other agents to execute complex tasks, proactively clear their context. 
To do so, send the `/new` or `/clear` (depending on the agent) command to the agent.

Example:
tmux send-keys -t <tmux_pane> "/clear"
tmux send-keys -t <tmux_pane> Enter

### SSH
- home-server → 192.168.1.100, user: admin

### TTS
- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
