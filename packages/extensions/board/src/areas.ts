import fs from "node:fs/promises";
import path from "node:path";

export type AreaSummary = {
  id: string;
  title: string;
  color: string;
  order: number;
  hidden: boolean;
  recentlyDone: string;
  whatsNext: string;
};

/**
 * Parse a simple YAML file (flat key: value pairs only).
 * Good enough for area config files like aihub.yaml.
 */
function parseSimpleYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    // Strip surrounding quotes
    value = value.replace(/^['"](.*)['"]$/, "$1");
    result[match[1] ?? ""] = value;
  }
  return result;
}

/**
 * Parse a loop.md file into recentlyDone and whatsNext sections.
 *
 * Expected format:
 * ```
 * # Title
 *
 * ## Recently Done
 * - bullet 1
 * - bullet 2
 *
 * ## What's Next
 * - bullet 1
 * ```
 */
function parseLoopFile(raw: string): {
  recentlyDone: string;
  whatsNext: string;
} {
  let recentlyDone = "";
  let whatsNext = "";

  // Find sections by heading
  const sections = raw.split(/^##\s+/m);
  for (const section of sections) {
    const firstNewline = section.indexOf("\n");
    if (firstNewline === -1) continue;
    const heading = section.slice(0, firstNewline).trim().toLowerCase();
    const body = section.slice(firstNewline + 1).trim();

    if (heading.includes("recently done") || heading.includes("done")) {
      recentlyDone = body;
    } else if (heading.includes("what's next") || heading.includes("next")) {
      whatsNext = body;
    }
  }

  return { recentlyDone, whatsNext };
}

/**
 * Toggle the `hidden` field in an area's YAML config.
 */
export async function toggleAreaHidden(
  projectsRoot: string,
  areaId: string,
  hidden: boolean,
): Promise<void> {
  const areasDir = path.join(projectsRoot, ".areas");
  const yamlFile = path.join(areasDir, `${areaId}.yaml`);

  let raw: string;
  try {
    raw = await fs.readFile(yamlFile, "utf-8");
  } catch {
    throw new Error(`Area config not found: ${areaId}`);
  }

  // Remove existing hidden line if present
  const lines = raw.split(/\r?\n/);
  const filtered = lines.filter((l) => !l.match(/^hidden:\s/));

  if (hidden) {
    // Insert hidden: true after the last non-empty line
    filtered.push("hidden: true");
  }

  // Ensure trailing newline
  const output = filtered.join("\n").replace(/\n*$/, "\n");
  await fs.writeFile(yamlFile, output, "utf-8");
}

/**
 * Scan ~/projects/.areas/ for *.yaml + *.loop.md pairs.
 * Returns area summaries sorted by order then title.
 */
export async function scanAreaSummaries(
  projectsRoot: string,
): Promise<AreaSummary[]> {
  const areasDir = path.join(projectsRoot, ".areas");

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(areasDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Collect area YAML configs
  const yamlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => e.name);

  const summaries: AreaSummary[] = [];

  for (const yamlFile of yamlFiles) {
    const areaId = yamlFile.replace(/\.yaml$/, "");

    // Read area config
    let yamlRaw: string;
    try {
      yamlRaw = await fs.readFile(path.join(areasDir, yamlFile), "utf-8");
    } catch {
      continue;
    }
    const config = parseSimpleYaml(yamlRaw);

    const id = config.id ?? areaId;
    const title = config.title ?? areaId;
    const color = config.color ?? "#6b7280";
    const order =
      config.order !== undefined ? Number.parseInt(config.order, 10) : 999;
    const hidden = config.hidden === "true";

    // Read loop file (optional)
    let recentlyDone = "";
    let whatsNext = "";

    const loopFile = path.join(areasDir, `${areaId}.loop.md`);
    try {
      const loopRaw = await fs.readFile(loopFile, "utf-8");
      const parsed = parseLoopFile(loopRaw);
      recentlyDone = parsed.recentlyDone;
      whatsNext = parsed.whatsNext;
    } catch {
      // No loop file — that's fine
    }

    summaries.push({ id, title, color, order, hidden, recentlyDone, whatsNext });
  }

  // Sort by order, then title
  summaries.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  return summaries;
}
