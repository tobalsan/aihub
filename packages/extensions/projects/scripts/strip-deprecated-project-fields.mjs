#!/usr/bin/env node
import { console } from "node:console";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";

const REMOVED_KEYS = ["appetite", "domain", "owner", "executionMode"];
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function projectsRoot() {
  return path.join(os.homedir(), "projects");
}

async function readProjectReadmes(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("PRO-"))
    .map((entry) => path.join(root, entry.name, "README.md"));
}

async function stripFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return "skipped";
    throw err;
  }

  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return "skipped";

  const frontmatter = yaml.load(match[1] ?? "") ?? {};
  if (
    typeof frontmatter !== "object" ||
    frontmatter === null ||
    Array.isArray(frontmatter)
  ) {
    return "skipped";
  }

  let changed = false;
  for (const key of REMOVED_KEYS) {
    if (Object.hasOwn(frontmatter, key)) {
      delete frontmatter[key];
      changed = true;
    }
  }
  if (!changed) return "skipped";

  const nextFrontmatter = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  await fs.writeFile(
    filePath,
    `---\n${nextFrontmatter}---\n${match[2] ?? ""}`,
    "utf8"
  );
  return "updated";
}

async function main() {
  const root = projectsRoot();
  const readmes = await readProjectReadmes(root);
  let updated = 0;
  let skipped = 0;

  for (const filePath of readmes) {
    const result = await stripFile(filePath);
    if (result === "updated") {
      updated += 1;
      globalThis.console.log(`updated ${filePath}`);
    } else {
      skipped += 1;
      globalThis.console.log(`skipped ${filePath}`);
    }
  }

  globalThis.console.log(`done: ${updated} updated, ${skipped} skipped`);
}

main().catch((err) => {
  globalThis.console.error(err);
  process.exit(1);
});
