// Telegram caps a single text message at 4096 characters. The outbound path
// renders agent markdown to Telegram HTML (see render.ts), so chunking has two
// jobs: stay within the limit, and keep every chunk independently valid HTML —
// Telegram rejects a message whose tags are unbalanced. We therefore split on
// line/whitespace boundaries and, when a multi-line <pre>/<code> block straddles
// a boundary, close the open tags at the end of one chunk and reopen them at the
// start of the next.
export const TELEGRAM_MAX = 4096;

// Tags the renderer can leave open across a chunk boundary. <pre>/<code> wrap
// multi-line blocks; <b>/<i>/<s>/<a>/<blockquote> can wrap a single markdown line
// that is itself longer than the limit. Any of these may straddle a split, so we
// track a stack of open tags and close/reopen them at the seam.
const KNOWN_TAGS = ["pre", "code", "b", "i", "s", "a", "blockquote"];
const TAG_RE = new RegExp(`</?(?:${KNOWN_TAGS.join("|")})(?:\\s[^>]*)?>`, "g");
// Worst-case length of the close sequence we may append to a chunk. Reserved
// from each chunk's budget so the appended closes never overflow the limit.
const MAX_CLOSE_LEN = KNOWN_TAGS.reduce((n, t) => n + t.length + 3, 0);

/**
 * Compute the tags left open at the end of `html` by walking a tag stack, and
 * return both the close sequence (to balance this chunk) and the reopen prefix
 * (to resume them in the next chunk). The reopen preserves the original opening
 * tag text, so e.g. `<code class="language-ts">` resumes with its class intact.
 */
function openTagsAfter(html: string): { reopen: string; close: string } {
  const stack: { name: string; open: string }[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    const tag = m[0];
    const name = tag.replace(/^<\/?/, "").replace(/[\s>].*$/, "");
    if (tag.startsWith("</")) {
      // Pop the matching open tag (well-formed renderer output nests cleanly).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push({ name, open: tag });
    }
  }

  if (stack.length === 0) return { reopen: "", close: "" };
  // Close in reverse (innermost first); reopen in original order.
  const close = stack
    .map((t) => `</${t.name}>`)
    .reverse()
    .join("");
  const reopen = stack.map((t) => t.open).join("");
  return { reopen, close };
}

function pushChunk(chunks: string[], chunk: string): void {
  if (chunk.length > 0) chunks.push(chunk);
}

/**
 * Split rendered HTML (or plain text) into Telegram-sized chunks without
 * dropping content and without leaving tags unbalanced. Plain text takes the
 * fast whitespace path; HTML with open multi-line blocks gets close/reopen
 * handling at each boundary.
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let carry = ""; // reopen prefix carried from the previous chunk

  while (carry.length + remaining.length > maxLength) {
    // Reserve room for the carry prefix and a possible close tag so neither the
    // reopen prefix nor the appended close pushes the chunk past the limit.
    const budget = maxLength - carry.length - MAX_CLOSE_LEN;
    const window = remaining.slice(0, budget);

    // Prefer a newline boundary, then a space; fall back to a hard cut. Never
    // cut inside an HTML tag or entity.
    let splitIndex = window.lastIndexOf("\n");
    if (splitIndex < budget / 2) splitIndex = window.lastIndexOf(" ");
    if (splitIndex < budget / 2) splitIndex = budget;
    splitIndex = avoidHtmlSplit(window, splitIndex);
    if (splitIndex === 0) splitIndex = Math.min(remaining.length, budget);

    const head = remaining.slice(0, splitIndex);
    const { reopen, close } = openTagsAfter(carry + head);

    pushChunk(chunks, carry + head + close);
    carry = reopen;
    remaining = remaining.slice(splitIndex);
  }

  pushChunk(chunks, carry + remaining);
  return chunks;
}

/**
 * If `index` lands inside an HTML tag (`<...>`) or entity (`&...;`), back up to
 * its start so we never split parser syntax in half.
 */
function avoidHtmlSplit(window: string, index: number): number {
  const entitySplit = avoidEntitySplit(window, index);
  return avoidTagSplit(window, entitySplit);
}

function avoidTagSplit(window: string, index: number): number {
  const lastOpen = window.lastIndexOf("<", index - 1);
  if (lastOpen < 0) return index;
  const close = window.indexOf(">", lastOpen);
  if (close >= index) return lastOpen;
  return index;
}

function avoidEntitySplit(window: string, index: number): number {
  const lastAmp = window.lastIndexOf("&", index - 1);
  if (lastAmp < 0) return index;
  const semicolon = window.indexOf(";", lastAmp);
  if (semicolon >= index) return lastAmp;
  return index;
}
