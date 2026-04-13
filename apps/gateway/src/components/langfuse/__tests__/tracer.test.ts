import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentStreamEvent,
  agentEventBus,
} from "../../../agents/events.js";
import { LangfuseTracer } from "../tracer.js";

const langfuseMock = vi.hoisted(() => {
  type MockGeneration = {
    args: unknown;
    update: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  type MockTrace = {
    args: unknown;
    generation: ReturnType<typeof vi.fn>;
    generations: MockGeneration[];
  };
  type MockLangfuse = {
    config: unknown;
    trace: ReturnType<typeof vi.fn>;
    flushAsync: ReturnType<typeof vi.fn>;
    shutdownAsync: ReturnType<typeof vi.fn>;
  };

  const instances: MockLangfuse[] = [];
  const traces: MockTrace[] = [];
  const generations: MockGeneration[] = [];

  const Langfuse = vi.fn(function (this: MockLangfuse, config: unknown) {
    this.config = config;
    this.trace = vi.fn((args: unknown) => {
      const trace: MockTrace = {
        args,
        generations: [],
        generation: vi.fn((generationArgs: unknown) => {
          const generation: MockGeneration = {
            args: generationArgs,
            update: vi.fn(),
            end: vi.fn(),
          };
          trace.generations.push(generation);
          generations.push(generation);
          return generation;
        }),
      };
      traces.push(trace);
      return trace;
    });
    this.flushAsync = vi.fn(async () => undefined);
    this.shutdownAsync = vi.fn(async () => undefined);
    instances.push(this);
  });

  return { Langfuse, generations, instances, traces };
});

vi.mock("langfuse", () => ({ default: langfuseMock.Langfuse }));

const tracerConfig = {
  publicKey: "pk-test",
  secretKey: "sk-test",
  baseUrl: "https://langfuse.test",
  flushAt: 2,
  flushInterval: 100,
};

describe("LangfuseTracer", () => {
  beforeEach(() => {
    vi.useRealTimers();
    langfuseMock.Langfuse.mockClear();
    langfuseMock.instances.length = 0;
    langfuseMock.traces.length = 0;
    langfuseMock.generations.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates one trace and one generation for a basic text turn", async () => {
    const tracer = startTracer();

    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "Hello" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: " world" })
    );
    await tracer.handleStreamEvent(streamEvent({ type: "done" }));

    expect(langfuseMock.Langfuse).toHaveBeenCalledWith({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://langfuse.test",
      flushAt: 2,
      flushInterval: 100,
    });
    expect(langfuseMock.traces).toHaveLength(1);
    expect(langfuseMock.traces[0]?.generation).toHaveBeenCalledTimes(1);
    expect(langfuseMock.generations[0]?.update).toHaveBeenCalledWith({
      output: "Hello world",
      metadata: { thinking: undefined },
      level: "DEFAULT",
      statusMessage: undefined,
    });
    expect(langfuseMock.generations[0]?.end).toHaveBeenCalledTimes(1);

    await tracer.stop();
  });

  it("stores thinking text in generation metadata only", async () => {
    const tracer = startTracer();

    await tracer.handleStreamEvent(
      streamEvent({ type: "thinking", data: "thinking " })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "thinking", data: "more" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "answer" })
    );
    await tracer.handleStreamEvent(streamEvent({ type: "done" }));

    expect(langfuseMock.generations[0]?.update).toHaveBeenCalledWith({
      output: "answer",
      metadata: { thinking: "thinking more" },
      level: "DEFAULT",
      statusMessage: undefined,
    });

    await tracer.stop();
  });

  it("marks the current generation as error", async () => {
    const tracer = startTracer();

    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "partial" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "error", message: "model failed" })
    );

    expect(langfuseMock.generations[0]?.update).toHaveBeenCalledWith({
      output: "partial",
      metadata: { thinking: undefined },
      level: "ERROR",
      statusMessage: "model failed",
    });
    expect(langfuseMock.generations[0]?.end).toHaveBeenCalledTimes(1);

    await tracer.stop();
  });

  it("reuses the same trace for multiple turns in one session", async () => {
    const tracer = startTracer();

    await tracer.handleStreamEvent(streamEvent({ type: "text", data: "one" }));
    await tracer.handleStreamEvent(streamEvent({ type: "done" }));
    await tracer.handleStreamEvent(streamEvent({ type: "text", data: "two" }));
    await tracer.handleStreamEvent(streamEvent({ type: "done" }));

    expect(langfuseMock.traces).toHaveLength(1);
    expect(langfuseMock.traces[0]?.generation).toHaveBeenCalledTimes(2);
    expect(langfuseMock.generations[0]?.update).toHaveBeenCalledWith(
      expect.objectContaining({ output: "one" })
    );
    expect(langfuseMock.generations[1]?.update).toHaveBeenCalledWith(
      expect.objectContaining({ output: "two" })
    );

    await tracer.stop();
  });

  it("creates separate traces for separate sessions", async () => {
    const tracer = startTracer();

    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "one" }, { sessionId: "session-a" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "done" }, { sessionId: "session-a" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "two" }, { sessionId: "session-b" })
    );
    await tracer.handleStreamEvent(
      streamEvent({ type: "done" }, { sessionId: "session-b" })
    );

    expect(langfuseMock.traces).toHaveLength(2);
    expect(langfuseMock.traces[0]?.args).toEqual(
      expect.objectContaining({ sessionId: "session-a" })
    );
    expect(langfuseMock.traces[1]?.args).toEqual(
      expect.objectContaining({ sessionId: "session-b" })
    );

    await tracer.stop();
  });

  it("finalizes and removes idle traces", async () => {
    vi.useFakeTimers();
    const tracer = startTracer();

    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "stale" })
    );

    expect(traceCount(tracer)).toBe(1);

    await vi.advanceTimersByTimeAsync(35 * 60 * 1000);

    expect(traceCount(tracer)).toBe(0);
    expect(langfuseMock.generations[0]?.update).toHaveBeenCalledWith(
      expect.objectContaining({ output: "stale" })
    );
    expect(langfuseMock.generations[0]?.end).toHaveBeenCalledTimes(1);

    await tracer.stop();
  });

  it("does nothing when events arrive before start", async () => {
    const tracer = new LangfuseTracer(tracerConfig);

    await tracer.handleStreamEvent(
      streamEvent({ type: "text", data: "ignored" })
    );

    expect(langfuseMock.Langfuse).not.toHaveBeenCalled();
    expect(traceCount(tracer)).toBe(0);
  });

  it("leaves runner, SDK adapters, and history store unchanged", () => {
    const changedFiles = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "HEAD",
        "--",
        "apps/gateway/src/agents/runner.ts",
        "apps/gateway/src/sdk",
        "apps/gateway/src/history/store.ts",
      ],
      { encoding: "utf8" }
    );

    expect(changedFiles).toBe("");
  });
});

function startTracer(): LangfuseTracer {
  const tracer = new LangfuseTracer(tracerConfig);
  tracer.start(fakeBus());
  return tracer;
}

function fakeBus(): typeof agentEventBus {
  return {
    onStreamEvent: vi.fn(() => vi.fn()),
  } as unknown as typeof agentEventBus;
}

function streamEvent(
  event: Pick<AgentStreamEvent, "type"> & Partial<AgentStreamEvent>,
  overrides: Partial<
    Pick<AgentStreamEvent, "agentId" | "sessionId" | "sessionKey" | "source">
  > = {}
): AgentStreamEvent {
  return {
    agentId: "agent-1",
    sessionId: "session-1",
    sessionKey: "main",
    source: "web",
    ...event,
    ...overrides,
  } as AgentStreamEvent;
}

function traceCount(tracer: LangfuseTracer): number {
  return (tracer as unknown as { traces: Map<string, unknown> }).traces.size;
}
