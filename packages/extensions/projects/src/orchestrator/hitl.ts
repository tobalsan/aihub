export type HitlEvent = {
  kind: string;
  sliceId: string;
  projectId: string;
  summary: string;
  link?: string;
  dedupeKey?: string;
};

export type HitlBurstNotifier = (message: string) => Promise<void> | void;

export type HitlBurstBuffer = {
  add(event: HitlEvent): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
  size(): number;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type HitlBurstBufferOptions = {
  notify: HitlBurstNotifier;
  windowMs?: number;
  cap?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  log?: (message: string) => void;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_CAP = 5;

function eventKey(event: HitlEvent): string {
  return (
    event.dedupeKey ??
    `${event.kind}:${event.projectId}:${event.sliceId}:${event.summary}`
  );
}

function formatBurst(events: HitlEvent[]): string {
  const byProject = new Map<string, HitlEvent[]>();
  for (const event of events) {
    const projectEvents = byProject.get(event.projectId) ?? [];
    projectEvents.push(event);
    byProject.set(event.projectId, projectEvents);
  }

  const lines = ["HITL check-in"];
  for (const [projectId, projectEvents] of byProject) {
    lines.push("", `${projectId}:`);
    for (const event of projectEvents) {
      const link = event.link ? ` (${event.link})` : "";
      lines.push(`- [${event.kind}] ${event.sliceId}: ${event.summary}${link}`);
    }
  }
  return lines.join("\n");
}

export function createHitlBurstBuffer(
  options: HitlBurstBufferOptions
): HitlBurstBuffer {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const cap = options.cap ?? DEFAULT_CAP;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const log = options.log ?? (() => {});
  const queued: HitlEvent[] = [];
  const seen = new Set<string>();
  let timer: TimerHandle | null = null;
  let flushing: Promise<void> | null = null;

  const clearScheduledFlush = (): void => {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  };

  const flush = async (): Promise<void> => {
    if (flushing) {
      await flushing;
      if (queued.length > 0) await flush();
      return;
    }
    clearScheduledFlush();
    if (queued.length === 0) return;

    const events = queued.splice(0, queued.length);
    flushing = (async () => {
      try {
        await options.notify(formatBurst(events));
      } catch (error) {
        log(
          `component=orchestrator action=hitl_notify_failed error=${JSON.stringify(
            error instanceof Error ? error.message : String(error)
          )}`
        );
      } finally {
        flushing = null;
      }
    })();
    await flushing;
  };

  const scheduleFlush = (): void => {
    if (timer) return;
    timer = setTimer(() => {
      void flush();
    }, windowMs);
  };

  return {
    add(event: HitlEvent): void {
      const key = eventKey(event);
      if (seen.has(key)) return;
      seen.add(key);
      queued.push(event);
      if (queued.length >= cap) {
        void flush();
        return;
      }
      scheduleFlush();
    },
    flush,
    async stop(): Promise<void> {
      await flush();
      clearScheduledFlush();
    },
    size(): number {
      return queued.length;
    },
  };
}
