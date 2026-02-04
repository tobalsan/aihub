import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";

type LegacyState = {
  cli?: string;
  run_mode?: string;
  base_branch?: string;
  started_at?: string;
};

const LEGACY_FILES = ["state.json", "progress.json", "logs.jsonl", "history.jsonl", "config.json"];

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "EXDEV") {
      await fs.copyFile(source, target);
      await fs.unlink(source);
      return;
    }
    throw err;
  }
}

async function ensureConfig(sessionDir: string, fallbackStatePath: string): Promise<void> {
  const configPath = path.join(sessionDir, "config.json");
  if (await pathExists(configPath)) return;

  const state = (await readJson<LegacyState>(path.join(sessionDir, "state.json"))) ??
    (await readJson<LegacyState>(fallbackStatePath));
  if (!state) return;

  const created = typeof state.started_at === "string" && state.started_at.trim() ? state.started_at : new Date().toISOString();
  const config = {
    cli: typeof state.cli === "string" ? state.cli : undefined,
    runMode: typeof state.run_mode === "string" ? state.run_mode : undefined,
    baseBranch: typeof state.base_branch === "string" ? state.base_branch : undefined,
    created,
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function cleanupLegacyDir(legacyDir: string, sessionDir: string): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(legacyDir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length === 0) {
    await fs.rmdir(legacyDir);
    return;
  }

  const onlyLegacyFiles = entries.every((entry) => entry.isFile() && LEGACY_FILES.includes(entry.name));
  if (!onlyLegacyFiles) return;

  for (const entry of entries) {
    if (!(await pathExists(path.join(sessionDir, entry.name)))) return;
  }

  await fs.rm(legacyDir, { recursive: true, force: true });
}

export async function migrateLegacySessions(root: string, projectId: string, projectDir: string): Promise<void> {
  const legacyRoot = path.join(root, ".workspaces", projectId);
  if (!(await dirExists(legacyRoot))) return;

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(legacyRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const sessionsRoot = path.join(projectDir, "sessions");
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const legacyDir = path.join(legacyRoot, slug);

    let hasLegacyData = false;
    for (const file of LEGACY_FILES) {
      if (await pathExists(path.join(legacyDir, file))) {
        hasLegacyData = true;
        break;
      }
    }
    if (!hasLegacyData) continue;

    const sessionDir = path.join(sessionsRoot, slug);
    await fs.mkdir(sessionDir, { recursive: true });

    for (const file of LEGACY_FILES) {
      const legacyPath = path.join(legacyDir, file);
      if (!(await pathExists(legacyPath))) continue;
      const nextPath = path.join(sessionDir, file);
      if (await pathExists(nextPath)) continue;
      await moveFile(legacyPath, nextPath);
    }

    await ensureConfig(sessionDir, path.join(legacyDir, "state.json"));
    await cleanupLegacyDir(legacyDir, sessionDir);
  }

  try {
    const remaining = await fs.readdir(legacyRoot);
    if (remaining.length === 0) {
      await fs.rmdir(legacyRoot);
    }
  } catch {
    // ignore
  }
}
