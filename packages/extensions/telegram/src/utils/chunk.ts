// Telegram caps a single text message at 4096 characters. Walking-skeleton
// slice sends plain text, so we split on whitespace/newline boundaries near the
// limit. Rich rendering (code-fence-aware splitting) layers on in a later slice.
const TELEGRAM_MAX = 4096;

export function splitMessage(text: string, maxLength = TELEGRAM_MAX): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    let splitIndex = window.lastIndexOf("\n");
    if (splitIndex < maxLength / 2) {
      splitIndex = window.lastIndexOf(" ");
    }
    if (splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
