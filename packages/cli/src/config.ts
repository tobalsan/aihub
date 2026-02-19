import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type UserConfig = {
  apiUrl?: string;
  token?: string;
};

export type CliConfig = {
  apiUrl: string;
  token?: string;
};

function readUserConfig(): UserConfig {
  const filePath = path.join(os.homedir(), ".aihub", "config.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as UserConfig;
    return parsed;
  } catch {
    return {};
  }
}

function trimValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function resolveConfig(): CliConfig {
  const fileConfig = readUserConfig();
  const apiUrl =
    trimValue(process.env.AIHUB_API_URL) ??
    trimValue(process.env.AIHUB_URL) ??
    trimValue(fileConfig.apiUrl);

  if (!apiUrl) {
    throw new Error(
      'Missing AIHub API URL. Set AIHUB_API_URL (or AIHUB_URL) or add ~/.aihub/config.json with {"apiUrl":"http://..."}.'
    );
  }

  const token =
    trimValue(process.env.AIHUB_TOKEN) ?? trimValue(fileConfig.token);

  return { apiUrl, token };
}
