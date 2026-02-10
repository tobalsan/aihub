import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig } from "@aihub/shared";

const THREAD_FILE = "THREAD.md";
const DEFAULT_CONVERSATIONS_ROOT = "~/projects/.conversations";

export type ConversationMessage = {
  speaker: string;
  timestamp?: string;
  body: string;
};

export type ConversationListItem = {
  id: string;
  title: string;
  date?: string;
  source?: string;
  participants: string[];
  tags: string[];
  preview: string;
  attachments: string[];
};

export type ConversationDetail = ConversationListItem & {
  frontmatter: Record<string, unknown>;
  content: string;
  messages: ConversationMessage[];
};

export type ConversationListResult =
  | { ok: true; data: ConversationListItem[] }
  | { ok: false; error: string };

export type ConversationItemResult =
  | { ok: true; data: ConversationDetail }
  | { ok: false; error: string };

export type ResolveConversationAttachmentResult =
  | { ok: true; data: { name: string; path: string } }
  | { ok: false; error: string };

export type ConversationFilters = {
  q?: string;
  source?: string;
  tag?: string;
  participant?: string;
};

function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

function getConversationsRoot(_config: GatewayConfig): string {
  return expandPath(DEFAULT_CONVERSATIONS_ROOT);
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  const parseScalar = (value: string): unknown => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
    return trimmed.replace(/^["'](.*)["']$/, "$1");
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value !== "") {
      result[key] = parseScalar(value);
      continue;
    }

    const list: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const itemMatch = (lines[j] ?? "").match(/^\s*-\s+(.+)$/);
      if (!itemMatch) break;
      list.push(String(parseScalar(itemMatch[1] ?? "") ?? ""));
    }
    if (list.length > 0) {
      result[key] = list;
      i = j - 1;
      continue;
    }
    result[key] = "";
  }

  return result;
}

function splitThread(raw: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };
  return {
    frontmatter: parseFrontmatter(match[1] ?? ""),
    content: match[2] ?? "",
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function extractTitle(
  id: string,
  frontmatter: Record<string, unknown>,
  content: string
): string {
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return id;
}

function buildPreview(content: string): string {
  const cleaned = content
    .replace(/^#.*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177)}...`;
}

function parseMessages(content: string): ConversationMessage[] {
  const lines = content.split(/\r?\n/);
  const messages: ConversationMessage[] = [];
  let current: ConversationMessage | null = null;

  const speakerLine = /^\*\*(.+?)\*\*(?:\s+\(([^)]+)\))?:\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(speakerLine);
    if (match) {
      if (current) {
        current.body = current.body.trim();
        if (current.body) messages.push(current);
      }
      current = {
        speaker: (match[1] ?? "").trim(),
        timestamp: (match[2] ?? "").trim() || undefined,
        body: (match[3] ?? "").trim(),
      };
      continue;
    }
    if (!current) continue;
    current.body = current.body
      ? `${current.body}\n${line}`
      : line;
  }

  if (current) {
    current.body = current.body.trim();
    if (current.body) messages.push(current);
  }

  return messages;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeName(name: string): boolean {
  return Boolean(name) && name === path.basename(name) && !name.includes("..");
}

async function listAttachments(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== THREAD_FILE)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function parseConversationDir(
  root: string,
  id: string
): Promise<ConversationDetail | null> {
  if (!safeName(id)) return null;
  const dirPath = path.join(root, id);
  if (!(await dirExists(dirPath))) return null;

  const threadPath = path.join(dirPath, THREAD_FILE);
  if (!(await fileExists(threadPath))) return null;

  const raw = await fs.readFile(threadPath, "utf8");
  const { frontmatter, content } = splitThread(raw);
  const attachments = await listAttachments(dirPath);
  const title = extractTitle(id, frontmatter, content);
  const participants = toStringArray(frontmatter.participants);
  const tags = toStringArray(frontmatter.tags);
  const source = stringField(frontmatter.source);
  const date = stringField(frontmatter.date);
  const preview = buildPreview(content);
  const messages = parseMessages(content);

  return {
    id,
    title,
    date,
    source,
    participants,
    tags,
    preview,
    attachments,
    frontmatter,
    content,
    messages,
  };
}

function matchesFilter(item: ConversationListItem, filters: ConversationFilters): boolean {
  const q = filters.q?.trim().toLowerCase();
  const source = filters.source?.trim().toLowerCase();
  const tag = filters.tag?.trim().toLowerCase();
  const participant = filters.participant?.trim().toLowerCase();

  if (source && item.source?.toLowerCase() !== source) return false;
  if (tag && !item.tags.some((value) => value.toLowerCase() === tag)) {
    return false;
  }
  if (
    participant &&
    !item.participants.some((value) => value.toLowerCase() === participant)
  ) {
    return false;
  }
  if (!q) return true;

  const haystack = [
    item.title,
    item.preview,
    item.source ?? "",
    item.participants.join(" "),
    item.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export async function listConversations(
  config: GatewayConfig,
  filters: ConversationFilters = {}
): Promise<ConversationListResult> {
  const root = getConversationsRoot(config);
  if (!(await dirExists(root))) {
    return { ok: true, data: [] };
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const conversations: ConversationListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = await parseConversationDir(root, entry.name);
    if (!parsed) continue;
    const item: ConversationListItem = {
      id: parsed.id,
      title: parsed.title,
      date: parsed.date,
      source: parsed.source,
      participants: parsed.participants,
      tags: parsed.tags,
      preview: parsed.preview,
      attachments: parsed.attachments,
    };
    if (matchesFilter(item, filters)) {
      conversations.push(item);
    }
  }

  conversations.sort((a, b) => {
    const dateA = a.date ?? "";
    const dateB = b.date ?? "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return b.id.localeCompare(a.id);
  });

  return { ok: true, data: conversations };
}

export async function getConversation(
  config: GatewayConfig,
  id: string
): Promise<ConversationItemResult> {
  const root = getConversationsRoot(config);
  const parsed = await parseConversationDir(root, id);
  if (!parsed) return { ok: false, error: `Conversation not found: ${id}` };
  return { ok: true, data: parsed };
}

export async function resolveConversationAttachment(
  config: GatewayConfig,
  id: string,
  name: string
): Promise<ResolveConversationAttachmentResult> {
  if (!safeName(id) || !safeName(name)) {
    return { ok: false, error: "Invalid attachment path" };
  }
  const root = getConversationsRoot(config);
  const dirPath = path.join(root, id);
  if (!(await dirExists(dirPath))) {
    return { ok: false, error: `Conversation not found: ${id}` };
  }
  const filePath = path.join(dirPath, name);
  if (!(await fileExists(filePath))) {
    return { ok: false, error: `Attachment not found: ${name}` };
  }
  return {
    ok: true,
    data: {
      name,
      path: filePath,
    },
  };
}
