export type IrcMessage = { prefix?: string; command: string; params: string[]; trailing?: string };
export function parseIrcLine(line: string): IrcMessage | null {
  const source = line.replace(/[\r\n]+$/, ""); if (!source) return null;
  let rest = source; let prefix: string | undefined;
  if (rest.startsWith(":")) { const i = rest.indexOf(" "); if (i < 2) return null; prefix = rest.slice(1, i); rest = rest.slice(i + 1); }
  const trailingAt = rest.indexOf(" :"); const head = trailingAt < 0 ? rest : rest.slice(0, trailingAt); const tokens = head.trim().split(/\s+/).filter(Boolean); if (!tokens.length) return null;
  return { prefix, command: tokens[0].toUpperCase(), params: tokens.slice(1), trailing: trailingAt < 0 ? undefined : rest.slice(trailingAt + 2) };
}
export function nickFromPrefix(prefix?: string): string | undefined { return prefix?.split("!", 1)[0]; }
export function normalizeIrcText(text: string): string { const action = /^\u0001ACTION\s+(.+)\u0001$/.exec(text); return action ? `* ${action[1]}` : text; }
export function toPlainIrcText(text: string): string { return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1").replace(/<(https?:\/\/[^>]*)>/g, "$1").replace(/^#+[ \t]*/gm, "").replace(/[*_`]/g, "").trim(); }
export function isAddressed(text: string, nick: string): { addressed: boolean; text: string } { const match = new RegExp(`^\\s*${nick.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*[:,]\\s*`, "i").exec(text); return { addressed: !!match, text: match ? text.slice(match[0].length) : text }; }
const MAX_CHARS = 450;
function fitsIrcChunk(s: string, maxBytes: number): boolean { return s.length <= MAX_CHARS && Buffer.byteLength(s) <= maxBytes; }
function hardSplitIrcWord(word: string, maxBytes: number, out: string[]): void { let chunk = ""; for (const ch of word) { if (chunk && !fitsIrcChunk(chunk + ch, maxBytes)) { out.push(chunk); chunk = ch; } else chunk += ch; } if (chunk) out.push(chunk); }
function splitIrcLine(line: string, maxBytes: number, out: string[]): void { let chunk = ""; for (const word of line.split(/\s+/)) { if (!word) continue; const next = chunk ? `${chunk} ${word}` : word; if (fitsIrcChunk(next, maxBytes)) { chunk = next; continue; } if (chunk) out.push(chunk); if (fitsIrcChunk(word, maxBytes)) chunk = word; else { hardSplitIrcWord(word, maxBytes, out); chunk = ""; } } if (chunk) out.push(chunk); }
export function splitIrcText(text: string, maxBytes = 400): string[] { const out: string[] = []; for (const raw of text.split("\n")) { const line = raw.replace(/\s+$/, ""); if (line.trim()) splitIrcLine(line, maxBytes, out); } return out; }
