/**
 * Allowlist matching utilities for Discord users/channels
 *
 * Supports:
 * - IDs (string or number): "123456789", 123456789
 * - Usernames: "john"
 * - User tags: "john#1234"
 * - Prefixed: "discord:/user:123456789"
 */

export type AllowlistEntry = string | number;

/**
 * Normalize an allowlist entry to a comparable string
 */
function normalizeEntry(entry: AllowlistEntry): string {
  const str = String(entry).toLowerCase().trim();

  // Strip discord:/user: prefix
  if (str.startsWith("discord:/user:")) {
    return str.slice("discord:/user:".length);
  }

  // Strip discord:/channel: prefix
  if (str.startsWith("discord:/channel:")) {
    return str.slice("discord:/channel:".length);
  }

  return str;
}

/**
 * Check if a user matches an allowlist
 *
 * @param user - User info to check
 * @param allowlist - Array of allowed entries
 * @returns true if user matches any entry
 */
export function matchesUserAllowlist(
  user: { id: string; username?: string; discriminator?: string },
  allowlist: AllowlistEntry[] | undefined
): boolean {
  if (!allowlist || allowlist.length === 0) return false;

  const userId = user.id.toLowerCase();
  const username = user.username?.toLowerCase();
  const tag = user.username && user.discriminator ? `${user.username}#${user.discriminator}`.toLowerCase() : undefined;

  for (const entry of allowlist) {
    const normalized = normalizeEntry(entry);

    // Match by ID
    if (normalized === userId) return true;

    // Match by username
    if (username && normalized === username) return true;

    // Match by tag (user#1234)
    if (tag && normalized === tag) return true;
  }

  return false;
}

/**
 * Check if a channel ID matches an allowlist
 *
 * @param channelId - Channel ID to check
 * @param allowlist - Array of allowed channel IDs
 * @returns true if channel matches any entry
 */
export function matchesChannelAllowlist(
  channelId: string,
  allowlist: AllowlistEntry[] | undefined
): boolean {
  if (!allowlist || allowlist.length === 0) return false;

  const id = channelId.toLowerCase();

  for (const entry of allowlist) {
    const normalized = normalizeEntry(entry);
    if (normalized === id) return true;
  }

  return false;
}

/**
 * Check if any of multiple allowlists match a user
 *
 * @param user - User info to check
 * @param allowlists - Array of allowlists to check against
 * @returns true if user matches any entry in any allowlist
 */
export function matchesAnyUserAllowlist(
  user: { id: string; username?: string; discriminator?: string },
  ...allowlists: (AllowlistEntry[] | undefined)[]
): boolean {
  for (const list of allowlists) {
    if (matchesUserAllowlist(user, list)) return true;
  }
  return false;
}
