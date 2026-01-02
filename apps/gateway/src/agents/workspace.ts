import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Core files that indicate workspace is initialized (not brand-new)
const CORE_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
] as const;

const BOOTSTRAP_FILENAMES = [...CORE_FILENAMES, "BOOTSTRAP.md"] as const;

type BootstrapFileName = (typeof BOOTSTRAP_FILENAMES)[number];

export type BootstrapFile = {
  name: BootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

// Fallback templates if docs/templates not found
const FALLBACK_TEMPLATES: Record<BootstrapFileName, string> = {
  "AGENTS.md": `# AGENTS.md - Workspace

This folder is the agent's working directory.

## First run
If BOOTSTRAP.md exists, follow its ritual and delete it once complete.

## Safety
- Don't exfiltrate secrets or private data.
- Don't run destructive commands unless explicitly asked.
`,
  "SOUL.md": `# SOUL.md - Persona & Boundaries

- Keep replies concise and direct.
- Ask clarifying questions when needed.
`,
  "TOOLS.md": `# TOOLS.md - Local Notes

Add environment-specific notes here (camera names, SSH hosts, etc.).
`,
  "IDENTITY.md": `# IDENTITY.md - Agent Identity

- Name:
- Creature:
- Vibe:
- Emoji:
`,
  "USER.md": `# USER.md - User Profile

- Name:
- Preferred address:
- Timezone:
- Notes:
`,
  "BOOTSTRAP.md": `# BOOTSTRAP.md - First Run

Start a conversation to learn:
- Who am I? What am I?
- Who are you? How should I call you?

Update IDENTITY.md and USER.md, then delete this file.
`,
};

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/templates"
);

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return content.slice(endIndex + 4).replace(/^\s+/, "");
}

async function loadTemplate(name: BootstrapFileName): Promise<string> {
  try {
    const content = await fs.readFile(path.join(TEMPLATE_DIR, name), "utf-8");
    return stripFrontMatter(content);
  } catch {
    return FALLBACK_TEMPLATES[name];
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure bootstrap files exist in workspace directory.
 * Uses wx flag to only write if missing.
 * BOOTSTRAP.md is only created for brand-new workspaces (no core files exist).
 */
export async function ensureBootstrapFiles(workspaceDir: string): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });

  // Check if any core file exists - if so, workspace is not brand-new
  const coreFileChecks = await Promise.all(
    CORE_FILENAMES.map((name) => fileExists(path.join(workspaceDir, name)))
  );
  const hasAnyCoreFile = coreFileChecks.some(Boolean);

  // Determine which files to create
  const filesToCreate = hasAnyCoreFile
    ? CORE_FILENAMES // Skip BOOTSTRAP.md for existing workspaces
    : BOOTSTRAP_FILENAMES; // Include BOOTSTRAP.md for new workspaces

  const templates = await Promise.all(
    filesToCreate.map(async (name) => ({
      name,
      content: await loadTemplate(name),
    }))
  );

  await Promise.all(
    templates.map(({ name, content }) =>
      writeIfMissing(path.join(workspaceDir, name), content)
    )
  );
}

/**
 * Load bootstrap files from workspace directory.
 * Returns file info with content if exists, missing flag if not.
 */
export async function loadBootstrapFiles(
  workspaceDir: string
): Promise<BootstrapFile[]> {
  const result: BootstrapFile[] = [];

  for (const name of BOOTSTRAP_FILENAMES) {
    const filePath = path.join(workspaceDir, name);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      result.push({ name, path: filePath, content, missing: false });
    } catch {
      result.push({ name, path: filePath, missing: true });
    }
  }

  return result;
}

/**
 * Convert bootstrap files to contextFiles format for Pi SDK.
 */
export function buildBootstrapContextFiles(
  files: BootstrapFile[]
): Array<{ path: string; content: string }> {
  return files
    .filter((f) => !f.missing && f.content)
    .map((f) => ({ path: f.name, content: f.content! }));
}
