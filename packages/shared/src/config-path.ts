import os from "node:os";
import path from "node:path";

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), ".aihub", "aihub.json");
}

function trimValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function resolveConfigPath(configPath?: string): string {
  const rawPath =
    trimValue(configPath) ??
    trimValue(process.env.AIHUB_CONFIG) ??
    getDefaultConfigPath();
  if (rawPath.startsWith("~")) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  return path.resolve(rawPath);
}
