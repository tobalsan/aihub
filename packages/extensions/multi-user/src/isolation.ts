import path from "node:path";

export function getUserDataDir(userId: string, dataDir: string): string {
  return path.join(dataDir, "users", userId);
}

export function getUserSessionsPath(
  userId: string | undefined,
  dataDir: string
): string {
  return userId
    ? path.join(getUserDataDir(userId, dataDir), "sessions.json")
    : path.join(dataDir, "sessions.json");
}

export function getUserHistoryDir(
  userId: string | undefined,
  dataDir: string
): string {
  return userId
    ? path.join(getUserDataDir(userId, dataDir), "history")
    : path.join(dataDir, "history");
}
