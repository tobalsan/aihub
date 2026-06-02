import fs from "node:fs";
import { resolveHomeDir } from "@aihub/shared";

export type CliConfig = { apiUrl: string; token?: string };

type UserConfig = { apiUrl?: string; token?: string };

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function readUserConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(`${resolveHomeDir()}/aihub.json`, "utf8")) as UserConfig;
  } catch {
    return {};
  }
}

export function resolveConfig(): CliConfig {
  const fileConfig = readUserConfig();
  const apiUrl = trim(process.env.AIHUB_API_URL) ?? trim(process.env.AIHUB_URL) ?? trim(fileConfig.apiUrl);
  if (!apiUrl) {
    throw new Error('Missing AIHub API URL. Set AIHUB_API_URL (or AIHUB_URL) or add $AIHUB_HOME/aihub.json with {"apiUrl":"http://..."}.');
  }
  return { apiUrl, token: trim(process.env.AIHUB_TOKEN) ?? trim(fileConfig.token) };
}
