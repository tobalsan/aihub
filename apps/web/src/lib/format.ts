const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatTimestamp(timestamp: number): string {
  return timestampFormatter.format(new Date(timestamp));
}

export function formatCreatedRelative(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(date);
  created.setHours(0, 0, 0, 0);

  const days = Math.floor((today.getTime() - created.getTime()) / 86400000);
  if (days <= 0) return "Created today";
  if (days === 1) return "Created yesterday";
  if (days === 7) return "Created last week";
  if (days < 14) return `Created ${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `Created ${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function formatRunRelative(raw?: string | number): string {
  if (!raw) return "";
  const timestamp = typeof raw === "number" ? raw : Date.parse(raw);
  if (Number.isNaN(timestamp)) return "";

  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "Just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(diff / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatRelativeActivityTime(ts: number): string {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
