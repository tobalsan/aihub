import path from "node:path";
import { CONFIG_DIR } from "../../config/index.js";

export function getUserDataDir(userId: string, baseDir = CONFIG_DIR): string {
  return path.join(baseDir, "users", userId);
}

export function getUserSessionsPath(
  userId?: string,
  baseDir = CONFIG_DIR
): string {
  return userId
    ? path.join(getUserDataDir(userId, baseDir), "sessions.json")
    : path.join(baseDir, "sessions.json");
}


export function getUserHistoryDir(
  userId?: string,
  baseDir = CONFIG_DIR
): string {
  return userId
    ? path.join(getUserDataDir(userId, baseDir), "history")
    : path.join(baseDir, "history");
}
