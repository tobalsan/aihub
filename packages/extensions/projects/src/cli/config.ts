import fs from "node:fs";
import { resolveHomeDir } from "@aihub/shared";

type UserConfig = {
  apiUrl?: string;
  token?: string;
};

export type CliConfig = {
  apiUrl: string;
  token?: string;
};

function readUserConfig(): UserConfig {
  const filePath = `${resolveHomeDir()}/aihub.json`;
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
      'Missing AIHub API URL. Set AIHUB_API_URL (or AIHUB_URL) or add $AIHUB_HOME/aihub.json with {"apiUrl":"http://..."} (default home: user AIHub directory).'
    );
  }

  const token =
    trimValue(process.env.AIHUB_TOKEN) ?? trimValue(fileConfig.token);

  return { apiUrl, token };
}
