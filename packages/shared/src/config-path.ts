import os from "node:os";
import path from "node:path";

export function expandPath(rawPath: string): string {
  if (rawPath.startsWith("~")) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  return path.resolve(rawPath);
}

function trimValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function resolveHomeDir(): string {
  const homeDir = trimValue(process.env.AIHUB_HOME);
  if (homeDir) return expandPath(homeDir);

  const legacyConfigPath = trimValue(process.env.AIHUB_CONFIG);
  if (legacyConfigPath) {
    console.warn(
      "[config] AIHUB_CONFIG is deprecated; set AIHUB_HOME to the containing directory instead."
    );
    return path.dirname(expandPath(legacyConfigPath));
  }

  return path.join(os.homedir(), ".aihub");
}

export function getDefaultConfigPath(): string {
  return path.join(resolveHomeDir(), "aihub.json");
}

export function resolveConfigPath(configPath?: string): string {
  const rawPath = trimValue(configPath) ?? getDefaultConfigPath();
  return expandPath(rawPath);
}
