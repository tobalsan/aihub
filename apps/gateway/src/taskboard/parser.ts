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
 * Supports strings, numbers, booleans, and simple arrays.
 */
function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (value === "" || value === "~" || value === "null" || value === "[]") {
      result[key] = undefined;
    } else if (value === "true") {
      result[key] = true;
    } else if (value === "false") {
      result[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      result[key] = parseFloat(value);
    } else {
      // Strip quotes if present
      result[key] = value.replace(/^["'](.*)["']$/, "$1");
    }
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
