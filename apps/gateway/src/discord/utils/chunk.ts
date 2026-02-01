const DISCORD_MAX = 2000;

/**
 * Split text into chunks that fit Discord's 2000 char limit.
 * Preserves code fences when possible.
 */
export function splitMessage(text: string, maxLength = DISCORD_MAX): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  // Track if we're inside a code fence
  let openFence: string | null = null;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(openFence ? openFence + "\n" + remaining : remaining);
      break;
    }

    let chunk = remaining.slice(0, maxLength);
    let splitIndex = maxLength;

    // Check for open code fence in this chunk
    const fenceMatches = [...chunk.matchAll(/^(```\w*)/gm)];
    const closingFences = [...chunk.matchAll(/^```$/gm)];

    // Determine if chunk ends inside a code block
    let fencesOpen = openFence ? 1 : 0;
    for (const m of fenceMatches) {
      if (m[0] === "```") {
        fencesOpen--;
      } else {
        fencesOpen++;
      }
    }
    fencesOpen -= closingFences.length;
    const insideCodeBlock = fencesOpen > 0;

    // Find a good split point
    if (insideCodeBlock) {
      // Try to split at a newline to avoid breaking mid-line in code
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline > maxLength / 2) {
        splitIndex = lastNewline;
      }
    } else {
      // Outside code: prefer newline, then space
      let idx = chunk.lastIndexOf("\n");
      if (idx === -1 || idx < maxLength / 2) {
        idx = chunk.lastIndexOf(" ");
      }
      if (idx > maxLength / 2) {
        splitIndex = idx;
      }
    }

    chunk = remaining.slice(0, splitIndex);

    // If we're inside a code block, close it at end of chunk
    if (insideCodeBlock) {
      chunk = (openFence ? openFence + "\n" : "") + chunk + "\n```";
      // Find the fence type to re-open in next chunk
      const lastFence = [...remaining.slice(0, splitIndex).matchAll(/^(```\w*)/gm)].pop();
      openFence = lastFence ? lastFence[1] : "```";
    } else {
      if (openFence) {
        chunk = openFence + "\n" + chunk;
      }
      openFence = null;
    }

    chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
