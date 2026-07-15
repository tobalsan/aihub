export type IrcMessage = { prefix?: string; command: string; params: string[]; trailing?: string };
export function parseIrcLine(line: string): IrcMessage | null {
  const source = line.replace(/[\r\n]+$/, ""); if (!source) return null;
  let rest = source; let prefix: string | undefined;
  if (rest.startsWith(":")) { const i = rest.indexOf(" "); if (i < 2) return null; prefix = rest.slice(1, i); rest = rest.slice(i + 1); }
  const trailingAt = rest.indexOf(" :"); const head = trailingAt < 0 ? rest : rest.slice(0, trailingAt); const tokens = head.trim().split(/\s+/).filter(Boolean); if (!tokens.length) return null;
  return { prefix, command: tokens[0].toUpperCase(), params: tokens.slice(1), trailing: trailingAt < 0 ? undefined : rest.slice(trailingAt + 2) };
}
export function nickFromPrefix(prefix?: string): string | undefined { return prefix?.split("!", 1)[0]; }
export function normalizeIrcText(text: string): string { const ctcp = String.fromCharCode(1); const action = text.startsWith(`${ctcp}ACTION `) && text.endsWith(ctcp) ? text.slice(8, -1) : null; return action ? `* ${action}` : text; }
export function toPlainIrcText(text: string): string { return Array.from(text).filter((char) => { const code = char.charCodeAt(0); return code >= 0x20 && code !== 0x7f; }).join("").replace(/```/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim(); }
export function isAddressed(text: string, nick: string): { addressed: boolean; text: string } { const match = new RegExp(`^\\s*${nick.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*[:,]\\s*`, "i").exec(text); return { addressed: !!match, text: match ? text.slice(match[0].length) : text }; }
export function splitIrcText(text: string, maxBytes = 400): string[] { const out: string[] = []; let chunk = ""; for (const char of text.replace(/\r/g, "").split("\n").join(" ")) { if (Buffer.byteLength(chunk + char) > maxBytes) { if (chunk) out.push(chunk); chunk = char; } else chunk += char; } if (chunk) out.push(chunk); return out; }
