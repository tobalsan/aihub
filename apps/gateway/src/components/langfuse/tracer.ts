import Langfuse, {
  type LangfuseGenerationClient,
  type LangfuseTraceClient,
} from "langfuse";

import type { agentEventBus, AgentStreamEvent } from "../../agents/events.js";

const IDLE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TRACE_IDLE_TTL_MS = 30 * 60 * 1000;

type TracedStreamEvent = Extract<
  AgentStreamEvent,
  { type: "text" | "thinking" | "done" | "error" }
>;

export type LangfuseTracerConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  flushAt?: number;
  flushInterval?: number;
  debug?: boolean;
};

export type GenerationState = {
  generation: LangfuseGenerationClient;
  outputBuffer: string;
  thinkingBuffer: string;
};

export type TraceState = {
  trace: LangfuseTraceClient;
  currentGeneration: GenerationState | null;
  lastActivity: number;
};

type AgentEventBus = typeof agentEventBus;

export class LangfuseTracer {
  private langfuse: Langfuse | null = null;
  private unsubscribe: (() => void) | null = null;
  private idleCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly traces = new Map<string, TraceState>();

  constructor(private readonly config: LangfuseTracerConfig) {}

  start(bus: AgentEventBus): void {
    if (this.langfuse) return;

    this.langfuse = new Langfuse({
      publicKey: this.config.publicKey,
      secretKey: this.config.secretKey,
      baseUrl: this.config.baseUrl,
      flushAt: this.config.flushAt,
      flushInterval: this.config.flushInterval,
    });

    this.unsubscribe = bus.onStreamEvent(
      (event) => void this.handleStreamEvent(event)
    );
    this.idleCleanupInterval = setInterval(
      () => void this.cleanupIdleTraces(),
      IDLE_CLEANUP_INTERVAL_MS
    );
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.idleCleanupInterval) {
      clearInterval(this.idleCleanupInterval);
      this.idleCleanupInterval = null;
    }

    for (const [key, state] of this.traces) {
      this.finalizeGeneration(state);
      this.traces.delete(key);
    }

    if (this.langfuse) {
      await this.langfuse.flushAsync();
      await this.langfuse.shutdownAsync();
      this.langfuse = null;
    }
  }

  async handleStreamEvent(event: AgentStreamEvent): Promise<void> {
    if (!this.langfuse) return;

    if (!isTracedStreamEvent(event)) return;

    const trace = this.getTrace(event);
    trace.lastActivity = Date.now();

    switch (event.type) {
      case "text": {
        const generation = this.getGeneration(trace, event);
        generation.outputBuffer += event.data;
        break;
      }
      case "thinking": {
        const generation = this.getGeneration(trace, event);
        generation.thinkingBuffer += event.data;
        break;
      }
      case "done":
        this.finalizeGeneration(trace);
        await this.langfuse.flushAsync();
        break;
      case "error":
        this.finalizeGeneration(trace, event.message);
        await this.langfuse.flushAsync();
        break;
      default:
        break;
    }
  }

  private getTrace(event: AgentStreamEvent): TraceState {
    const key = this.traceKey(event);
    const existing = this.traces.get(key);
    if (existing) return existing;

    if (!this.langfuse) {
      throw new Error("Langfuse tracer is not started");
    }

    const trace = this.langfuse.trace({
      name: event.agentId,
      sessionId: event.sessionId,
      metadata: {
        source: event.source,
        sessionKey: event.sessionKey,
      },
    });
    const state: TraceState = {
      trace,
      currentGeneration: null,
      lastActivity: Date.now(),
    };
    this.traces.set(key, state);
    return state;
  }

  private getGeneration(
    trace: TraceState,
    event: AgentStreamEvent
  ): GenerationState {
    if (trace.currentGeneration) return trace.currentGeneration;

    const generation = trace.trace.generation({
      name: "llm-turn",
      metadata: {
        source: event.source,
        sessionKey: event.sessionKey,
      },
    });
    trace.currentGeneration = {
      generation,
      outputBuffer: "",
      thinkingBuffer: "",
    };
    return trace.currentGeneration;
  }

  private finalizeGeneration(trace: TraceState, errorMessage?: string): void {
    const generation = trace.currentGeneration;
    if (!generation) return;

    generation.generation.update({
      output: generation.outputBuffer,
      metadata: {
        thinking: generation.thinkingBuffer || undefined,
      },
      level: errorMessage ? "ERROR" : "DEFAULT",
      statusMessage: errorMessage,
    });
    generation.generation.end();
    trace.currentGeneration = null;
  }

  private async cleanupIdleTraces(): Promise<void> {
    const cutoff = Date.now() - TRACE_IDLE_TTL_MS;
    let removedTrace = false;

    for (const [key, state] of this.traces) {
      if (state.lastActivity >= cutoff) continue;

      this.finalizeGeneration(state);
      this.traces.delete(key);
      removedTrace = true;
    }

    if (removedTrace) {
      await this.langfuse?.flushAsync();
    }
  }

  private traceKey(event: AgentStreamEvent): string {
    return `${event.agentId}:${event.sessionId}`;
  }
}

function isTracedStreamEvent(
  event: AgentStreamEvent
): event is TracedStreamEvent {
  return (
    event.type === "text" ||
    event.type === "thinking" ||
    event.type === "done" ||
    event.type === "error"
  );
}
