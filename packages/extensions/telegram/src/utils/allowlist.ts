/**
 * Allowlist matching utilities for Telegram users and chats.
 *
 * Mirrors the discord/slack allowlist convention: an allowlist is an array of
 * entries, each a numeric/string id or a username, matched case-insensitively.
 * A `telegram:/user:` or `telegram:/chat:` prefix may be used for parity with
 * the discord `discord:/user:` / slack `slack:/user:` prefixed forms.
 *
 * Enforcement fails closed: when an allowlist is empty or omitted, nothing
 * matches, so callers treat that as "deny" (matching discord's allowlist
 * policy where an unconfigured allowlist serves no one).
 */

export type AllowlistEntry = string | number;

/** Normalize an allowlist entry (or candidate) to a comparable string. */
function normalizeEntry(entry: AllowlistEntry): string {
  const value = String(entry).toLowerCase().trim();
  if (value.startsWith("telegram:/user:")) {
    return value.slice("telegram:/user:".length);
  }
  if (value.startsWith("telegram:/chat:")) {
    return value.slice("telegram:/chat:".length);
  }
  // Usernames may be written with a leading "@"; strip it so "@alice" and
  // "alice" are equivalent.
  if (value.startsWith("@")) {
    return value.slice(1);
  }
  return value;
}

function matchesAllowlist(
  candidates: (string | undefined)[],
  allowlist: AllowlistEntry[] | undefined
): boolean {
  if (!allowlist || allowlist.length === 0) return false;

  const normalizedCandidates = candidates
    .filter((c): c is string => c !== undefined && c.length > 0)
    .map((c) => normalizeEntry(c));
  if (normalizedCandidates.length === 0) return false;

  return allowlist.some((entry) => {
    const normalized = normalizeEntry(entry);
    return normalizedCandidates.includes(normalized);
  });
}

/**
 * Check whether a Telegram user matches an allowlist, by numeric id or username.
 */
export function matchesUserAllowlist(
  user: { id: number | undefined; username?: string },
  allowlist: AllowlistEntry[] | undefined
): boolean {
  const id = user.id !== undefined ? String(user.id) : undefined;
  return matchesAllowlist([id, user.username], allowlist);
}

/**
 * Check whether a Telegram chat matches an allowlist, by numeric id or username
 * (public groups/channels expose an `@username`).
 */
export function matchesChatAllowlist(
  chat: { id: number | undefined; username?: string },
  allowlist: AllowlistEntry[] | undefined
): boolean {
  const id = chat.id !== undefined ? String(chat.id) : undefined;
  return matchesAllowlist([id, chat.username], allowlist);
}
