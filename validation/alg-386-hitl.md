# ALG-386 manual Slack round-trip validation

Status: blocked pending access to a real Slack workspace and a human participant.

The required scenario cannot be exercised by the repository's gateway/web E2E
playbook: it has no Slack Socket Mode app credentials and cannot provide the
required human thread reply.

Run this in a real workspace after configuring a bot with the scopes and Socket
Mode settings documented in `packages/extensions/slack/README.md`:

1. Enable `scheduler` and Slack routing for the target agent; retain the
   gateway log and the scheduler output file for the run.
2. Add or manually fire a cron job whose prompt calls `slack.create_thread` in
   a configured channel or to a permitted user ID.
3. Capture the parent message's channel and timestamp, the scheduler session
   ID, and the persisted thread-session binding.
4. Have a human reply in that exact thread.
5. Capture the inbound route/session ID and Slack transcript showing exactly
   one agent answer in the same thread. Confirm no top-level duplicate and no
   main-session delivery.

Attach or link the redacted Slack transcript and relevant logs here once the
human-in-the-loop run completes.
