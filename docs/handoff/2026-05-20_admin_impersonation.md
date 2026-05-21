# Admin read-only impersonation

Implemented server-side read-only admin impersonation keyed by admin session.

- Added in-memory impersonation state, audit logs, start/end/status endpoints.
- Auth middleware swaps effective user context for admin session impersonation; bearer API keys ignore impersonation.
- Gateway write guard rejects non-GET while impersonating except end/signout/status.
- WebSocket subscribe uses target context; send returns `read_only_impersonation`.
- Web admin users table has `View as`; root banner has `Exit`; chat composer/file attach disabled while active.
- Focused tests added for impersonation state and middleware context swap/bearer ignore.
