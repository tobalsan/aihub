export type AllowlistEntry = string | number;

function normalizeEntry(entry: AllowlistEntry): string {
  const value = String(entry).toLowerCase().trim();
  if (value.startsWith("slack:/user:")) {
    return value.slice("slack:/user:".length);
  }
  return value;
}

export function matchesUserAllowlist(
  userId: string,
  allowlist: AllowlistEntry[] | undefined
): boolean {
  if (!allowlist || allowlist.length === 0) return false;

  const normalizedUserId = userId.toLowerCase();
  return allowlist.some((entry) => normalizeEntry(entry) === normalizedUserId);
}
