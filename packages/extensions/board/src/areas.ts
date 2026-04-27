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

// ── YAML helper ─────────────────────────────────────────────────────

function parseSimpleYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    value = value.replace(/^['"](.*)['"]$/, "$1");
    result[match[1] ?? ""] = value;
  }
  return result;
}

// ── Loop file parser (dated-entry format) ───────────────────────────

/** Regex that matches a dated entry header: [[YYYY-MM-DD]] at line start */
const ENTRY_DATE_RE = /^\[\[(\d{4}-\d{2}-\d{2})\]\]/;

/** Regex that matches a "Next:" separator line (various styles) */
const NEXT_RE = /^(?:next\s*:|next\s+is\b|todo\s+next\s*:)/i;

type LoopEntry = {
  date: string;
  body: string;
};

/**
 * Split a loop.md file into dated entries.
 * Returns entries in file order (oldest first).
 */
export function parseLoopEntries(raw: string): LoopEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: LoopEntry[] = [];
  let currentDate: string | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentDate) {
      entries.push({
        date: currentDate,
        body: currentLines.join("\n").trim(),
      });
    }
  }

  for (const line of lines) {
    const dateMatch = line.match(ENTRY_DATE_RE);
    if (dateMatch) {
      flush();
      currentDate = dateMatch[1]!;
      // Text on the same line after the date header
      const rest = line.slice(dateMatch[0].length).trim();
      currentLines = rest ? [rest] : [];
    } else if (currentDate !== null) {
      currentLines.push(line);
    }
    // Lines before the first dated entry are ignored (title, frontmatter, etc.)
  }
  flush();

  return entries;
}

/**
 * Extract recentlyDone and whatsNext from a single entry body.
 * Everything before a "Next:" line is done; everything after is next.
 */
export function splitEntryContent(body: string): {
  recentlyDone: string;
  whatsNext: string;
} {
  const lines = body.split(/\r?\n/);
  let splitIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (NEXT_RE.test(lines[i]!.trim())) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === -1) {
    return { recentlyDone: body.trim(), whatsNext: "" };
  }

  const done = lines.slice(0, splitIndex).join("\n").trim();

  // The "Next:" line itself may contain inline content: "Next: do X"
  const nextHeaderLine = lines[splitIndex]!;
  const nextInline = nextHeaderLine.replace(NEXT_RE, "").trim();
  const nextBody = lines.slice(splitIndex + 1).join("\n").trim();
  const whatsNext = nextInline
    ? nextInline + (nextBody ? "\n" + nextBody : "")
    : nextBody;

  return { recentlyDone: done, whatsNext };
}

/**
 * Parse a loop.md and return the latest entry's content for display.
 */
function parseLoopFile(raw: string): {
  recentlyDone: string;
  whatsNext: string;
} {
  const entries = parseLoopEntries(raw);
  if (entries.length === 0) return { recentlyDone: "", whatsNext: "" };
  const latest = entries[entries.length - 1]!;
  return splitEntryContent(latest.body);
}

// ── Area hidden toggle ──────────────────────────────────────────────

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

  const lines = raw.split(/\r?\n/);
  const filtered = lines.filter((l) => !l.match(/^hidden:\s/));

  if (hidden) {
    filtered.push("hidden: true");
  }

  const output = filtered.join("\n").replace(/\n*$/, "\n");
  await fs.writeFile(yamlFile, output, "utf-8");
}

// ── Loop entry update (append or replace today) ─────────────────────

/**
 * Append a new dated entry to a loop file, or replace today's entry
 * if one already exists (idempotent for the same day).
 */
export async function updateLoopEntry(
  projectsRoot: string,
  areaId: string,
  date: string,
  body: string,
): Promise<void> {
  const areasDir = path.join(projectsRoot, ".areas");
  const loopFile = path.join(areasDir, `${areaId}.loop.md`);

  let raw: string;
  try {
    raw = await fs.readFile(loopFile, "utf-8");
  } catch {
    // No loop file yet — create one with a title
    const yamlFile = path.join(areasDir, `${areaId}.yaml`);
    let title = areaId;
    try {
      const yamlRaw = await fs.readFile(yamlFile, "utf-8");
      const config = parseSimpleYaml(yamlRaw);
      title = config.title ?? areaId;
    } catch {
      // use areaId as title
    }
    raw = `# ${title}\n`;
  }

  const lines = raw.split(/\r?\n/);
  const entryHeader = `[[${date}]]`;

  // Find if today's entry already exists
  let todayStart = -1;
  let todayEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i]!.match(ENTRY_DATE_RE);
    if (dateMatch) {
      if (dateMatch[1] === date) {
        todayStart = i;
      } else if (todayStart !== -1 && todayEnd === -1) {
        // Next entry after today's — today ends at previous line
        todayEnd = i;
      }
    }
  }

  const entryLines = [`${entryHeader}`, ...body.split(/\r?\n/)];

  if (todayStart !== -1) {
    // Replace today's entry
    if (todayEnd === -1) todayEnd = lines.length;
    // Trim trailing blank lines from the replaced region
    while (todayEnd > todayStart + 1 && lines[todayEnd - 1]!.trim() === "") {
      todayEnd--;
    }
    lines.splice(todayStart, todayEnd - todayStart, ...entryLines);
  } else {
    // Append new entry — ensure blank line before it
    const trimmedLines = [...lines];
    while (
      trimmedLines.length > 0 &&
      trimmedLines[trimmedLines.length - 1]!.trim() === ""
    ) {
      trimmedLines.pop();
    }
    trimmedLines.push("", ...entryLines);
    lines.length = 0;
    lines.push(...trimmedLines);
  }

  const output = lines.join("\n").replace(/\n*$/, "\n");
  await fs.writeFile(loopFile, output, "utf-8");
}

// ── Area scanner ────────────────────────────────────────────────────

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

  const yamlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => e.name);

  const summaries: AreaSummary[] = [];

  for (const yamlFile of yamlFiles) {
    const areaId = yamlFile.replace(/\.yaml$/, "");

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

  summaries.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  return summaries;
}
