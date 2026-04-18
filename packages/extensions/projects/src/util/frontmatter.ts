export type ParsedFrontmatter = {
  frontmatter: Record<string, unknown>;
  content: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatterValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === "" || value === "~" || value === "null" || value === "[]") {
    return undefined;
  }
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Fall through to scalar parsing.
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value.replace(/^["'](.*)["']$/, "$1");
}

export function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value !== "") {
      result[key] = parseFrontmatterValue(value);
      continue;
    }

    const list: unknown[] = [];
    let listIndex = i + 1;
    for (; listIndex < lines.length; listIndex += 1) {
      const itemMatch = (lines[listIndex] ?? "").match(/^\s*-\s+(.+)$/);
      if (!itemMatch) break;
      list.push(parseFrontmatterValue(itemMatch[1] ?? ""));
    }
    if (list.length > 0) {
      result[key] = list;
      i = listIndex - 1;
      continue;
    }

    const nested: Record<string, unknown> = {};
    let nestedIndex = i + 1;
    let foundNested = false;
    for (; nestedIndex < lines.length; nestedIndex += 1) {
      const nestedMatch = (lines[nestedIndex] ?? "").match(
        /^\s+([A-Za-z0-9_]+):\s*(.*)$/
      );
      if (!nestedMatch) break;
      foundNested = true;
      nested[nestedMatch[1] ?? ""] = parseFrontmatterValue(
        nestedMatch[2] ?? ""
      );
    }
    if (foundNested) {
      result[key] = nested;
      i = nestedIndex - 1;
      continue;
    }

    result[key] = undefined;
  }

  return result;
}

export function splitFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: {}, content: raw };
  }
  return {
    frontmatter: parseFrontmatter(match[1] ?? ""),
    content: match[2] ?? "",
  };
}
