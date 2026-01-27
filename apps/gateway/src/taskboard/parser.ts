import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ParsedFile = {
  frontmatter: Record<string, unknown>;
  content: string;
  title: string;
};

/**
 * Parses a markdown file with YAML frontmatter.
 * Extracts frontmatter fields, full content, and title from first # heading.
 */
export async function parseMarkdownFile(filePath: string): Promise<ParsedFile> {
  const raw = await fs.readFile(filePath, "utf-8");
  return parseMarkdownContent(raw, path.basename(filePath, ".md"));
}

/**
 * Parses markdown content with YAML frontmatter.
 */
export function parseMarkdownContent(
  raw: string,
  fallbackTitle: string
): ParsedFile {
  let frontmatter: Record<string, unknown> = {};
  let content = raw;

  // Extract YAML frontmatter (between --- delimiters)
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = parseYamlFrontmatter(fmMatch[1]);
    content = fmMatch[2];
  }

  // Extract title: frontmatter.title > first line (strip # if heading) > filename
  const firstLineMatch = content.match(/^\s*(.+)$/m);
  const firstLine = firstLineMatch?.[1]?.trim() || "";
  // Strip leading # if it's a heading
  const titleFromContent = firstLine.replace(/^#+\s*/, "");
  const title =
    (frontmatter.title as string) ||
    titleFromContent ||
    extractTitleFromFilename(fallbackTitle);

  return { frontmatter, content, title };
}

/**
 * Simple YAML frontmatter parser (handles key: value pairs).
 * Supports strings, numbers, booleans, and one-level nested maps.
 */
function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  const parseValue = (rawValue: string): unknown => {
    const value = rawValue.trim();
    if (value === "" || value === "~" || value === "null" || value === "[]") {
      return undefined;
    }
    if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        // fall through
      }
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
    return value.replace(/^["'](.*)["']$/, "$1");
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (value === "") {
      const nested: Record<string, unknown> = {};
      let foundNested = false;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (!nextLine.trim()) break;
        const nestedMatch = nextLine.match(/^\s+(\w+):\s*(.*)$/);
        if (!nestedMatch) break;
        foundNested = true;
        nested[nestedMatch[1]] = parseValue(nestedMatch[2] ?? "");
        j += 1;
      }
      if (foundNested) {
        result[key] = nested;
        i = j - 1;
      } else {
        result[key] = undefined;
      }
      continue;
    }

    result[key] = parseValue(value);
  }

  return result;
}

/**
 * Extracts a human-readable title from a filename.
 * Handles format: `PRO-{N}_{date}_{slug}.md` or `PER-{N}_{date}_{slug}.md`
 */
function extractTitleFromFilename(filename: string): string {
  // Remove ID prefix and date: PRO-19_20260120_slug -> slug
  const withoutPrefix = filename.replace(/^(PRO|PER)-\d+_\d{8}_/, "");
  // Convert underscores/dashes to spaces and title case
  return withoutPrefix
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
