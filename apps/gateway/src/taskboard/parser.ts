import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitFrontmatter } from "../util/frontmatter.js";

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
  const { frontmatter, content } = splitFrontmatter(raw);

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
