import type { ContentBlock } from "../api/types";

export function extractBlockText(text: unknown): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object") {
    const obj = text as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return (obj.content as Array<Record<string, unknown>>)
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text as string)
        .join("\n");
    }
  }
  return "";
}

export function getTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => extractBlockText((block as { text: unknown }).text))
    .join("\n");
}
