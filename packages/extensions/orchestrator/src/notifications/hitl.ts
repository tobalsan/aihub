export function createHitlBurstBuffer(input: { flush: (messages: string[]) => void | Promise<void>; windowMs?: number; maxItems?: number }) {
  const windowMs = input.windowMs ?? 60_000;
  const maxItems = input.maxItems ?? 5;
  let messages: string[] = [];
  let timer: NodeJS.Timeout | undefined;
  async function flushNow() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = [...new Set(messages)];
    messages = [];
    if (batch.length) await input.flush(batch);
  }
  return {
    push(message: string) {
      messages.push(message);
      if (messages.length >= maxItems) void flushNow();
      else timer ??= setTimeout(() => void flushNow(), windowMs);
    },
    flush: flushNow,
  };
}
