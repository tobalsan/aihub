import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexAppServerRunner } from "./codex-app-server.js";
import type { WorkerRunnerStartInput } from "./runner.js";

async function writeMockServer(dir: string): Promise<string> {
  const script = path.join(dir, "mock-codex.mjs");
  await fs.writeFile(script, `
import readline from "node:readline";

const mode = process.env.MOCK_CODEX_MODE ?? "complete";
const rl = readline.createInterface({ input: process.stdin });

function write(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({ id: message.id, result: {} });
  } else if (message.method === "initialized") {
    // no-op
  } else if (message.method === "thread/start") {
    write({ method: "thread/started", params: { thread: { id: "thr_1", sessionId: "thr_1" } } });
    write({ id: message.id, result: { thread: { id: "thr_1", sessionId: "thr_1" } } });
  } else if (message.method === "turn/start") {
    const turnId = "turn_1";
    write({ method: "turn/started", params: { turn: { id: turnId, status: "inProgress" } } });
    write({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    if (mode === "complete") {
      write({ method: "item/completed", params: { item: { id: "msg_1", type: "agentMessage", text: "done" } } });
      write({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
    } else if (mode === "multi-turn") {
      // ALG-174 shape: intermediate turn/completed followed by inter-turn activity and a second turn
      write({ method: "item/completed", params: { item: { id: "msg_1", type: "agentMessage", text: "thinking", phase: "commentary" } } });
      write({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } });
      // After 5ms: inter-turn activity (e.g. git status output) — resets settle timer
      setTimeout(() => {
        write({ method: "item/completed", params: { item: { id: "tool_1", type: "commandExecution", command: ["git", "status"], cwd: process.cwd(), status: "completed" } } });
      }, 5);
      // After 10ms: a second turn starts (with its own turn/completed)
      setTimeout(() => {
        write({ method: "turn/started", params: { turn: { id: "turn_2", status: "inProgress" } } });
        write({ method: "item/completed", params: { item: { id: "tool_2", type: "commandExecution", command: ["gh", "pr", "create"], cwd: process.cwd(), status: "completed" } } });
        write({ method: "turn/completed", params: { turn: { id: "turn_2", status: "completed" } } });
        // After this, silence — runner must detect quiescence via settle timer
      }, 10);
    } else if (mode === "long-tool") {
      // turn/completed arrives first, then an item/started for a slow tool (no further output for >idleSettleMs)
      write({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
      setTimeout(() => {
        write({ method: "item/started", params: { item: { id: "slow_cmd_1", type: "commandExecution", command: ["pnpm", "test"] } } });
      }, 5);
      // item/completed arrives after 60ms — longer than the 20ms settle window used in the test
      setTimeout(() => {
        write({ method: "item/completed", params: { item: { id: "slow_cmd_1", type: "commandExecution", status: "completed" } } });
      }, 60);
    } else if (mode === "dropped-item") {
      // turn/completed arrives, then item/started, but item/completed is never emitted.
      // The per-item watchdog must fire and unblock the settle timer.
      write({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
      setTimeout(() => {
        write({ method: "item/started", params: { item: { id: "zombie_1", type: "commandExecution", command: ["pnpm", "test"] } } });
      }, 5);
      // item/completed intentionally omitted
    }
    // mode "hold": no turn/completed emitted; session stays active
  } else if (message.method === "turn/steer") {
    write({ id: message.id, result: {} });
    // In complete mode, steer triggers a new turn completion cycle
    if (mode === "complete") {
      write({ method: "turn/started", params: { turn: { id: "turn_steer", status: "inProgress" } } });
      write({ method: "item/completed", params: { item: { id: "msg_steer", type: "agentMessage", text: "steered" } } });
      write({ method: "turn/completed", params: { turn: { id: "turn_steer", status: "completed" } } });
    }
  } else if (message.method === "turn/interrupt") {
    write({ id: message.id, result: {} });
    write({ method: "turn/completed", params: { turn: { id: "turn_1", status: "interrupted" } } });
  }
});
`);
  return script;
}

function makeInput(root: string, command: string[], extra: Partial<WorkerRunnerStartInput> = {}): WorkerRunnerStartInput {
  return {
    runId: "run-1",
    project: { id: "proj", path: root, workflowPath: path.join(root, "WORKFLOW.md") },
    issue: { id: "iss-1", identifier: "ENG-1", title: "Test", state: "Ready", labels: [] },
    workspace: root,
    prompt: "do the work",
    label: "ENG-1",
    profile: { name: "default", cli: "codex", model: "gpt-5" },
    workflow: {
      tracker: { kind: "linear", endpoint: "x", apiKey: "x", projectSlug: "proj", activeStates: ["Ready"], terminalStates: ["Done"], needsHuman: "Needs Human" },
      workspace: { root, cleanupOnTerminal: false, reuse: true },
      polling: { intervalMs: 1000, jitterMs: 0 },
      agent: { runner: "codex", command, model: "gpt-5" },
      hooks: {},
      server: undefined,
      linear: undefined,
    },
    ...extra,
  };
}

describe("CodexAppServerRunner quiescence", () => {
  it("does not mark done on turn/completed — waits for settle period before setting status=done", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-settle-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "complete";
    const events: string[] = [];
    const runner = new CodexAppServerRunner({ idleSettleMs: 30, idleCleanupMs: 200, terminalRetentionMs: 100 });
    try {
      const handle = await runner.start(makeInput(root, [process.execPath, script], {
        emitEvent: (type) => events.push(type),
      }));

      // Give the event loop a tick so the notification is processed
      await new Promise((r) => setTimeout(r, 5));

      // After turn/completed the status must still be "running" — settle hasn't fired
      expect(await runner.status(handle)).toMatchObject({ status: "running" });

      // After the settle window the status becomes done
      await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "done" }), { timeout: 500 });
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });

  it("(ALG-174 regression) activity after turn/completed resets settle timer — process is not killed mid-flight", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-alg174-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "multi-turn";
    const events: string[] = [];
    // idleSettleMs=40 is longer than the mock's inter-turn delays (5ms, 10ms),
    // so activity between turns resets the timer before it fires
    const runner = new CodexAppServerRunner({ idleSettleMs: 40, idleCleanupMs: 200, terminalRetentionMs: 100 });
    try {
      const handle = await runner.start(makeInput(root, [process.execPath, script], {
        emitEvent: (type) => events.push(type),
      }));

      // After first turn/completed but before inter-turn activity, status is still running
      await new Promise((r) => setTimeout(r, 3));
      expect(await runner.status(handle)).toMatchObject({ status: "running" });

      // After inter-turn activity (5ms) and second turn (10ms) + settle (40ms) → done
      await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "done" }), { timeout: 500 });

      // The runner emitted tool events from both turns
      expect(events.filter((e) => e === "worker.codex.tool").length).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });

  it("turn/started cancels settle timer — no premature done when a new turn immediately follows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-turn-started-cancel-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "multi-turn";
    // idleSettleMs=150ms >> mock inter-turn delays (5ms, 10ms); wide margin reduces flakiness
    const runner = new CodexAppServerRunner({ idleSettleMs: 150, idleCleanupMs: 400, terminalRetentionMs: 100 });
    try {
      const handle = await runner.start(makeInput(root, [process.execPath, script]));

      // At t=10ms the mock emits turn/started for the second turn, cancelling the settle timer
      // armed by the first turn/completed at t=0.
      // Status should still be "running" at t=60ms (well before the ~160ms second settle).
      await new Promise((r) => setTimeout(r, 60));
      expect(await runner.status(handle)).toMatchObject({ status: "running" });

      await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "done" }), { timeout: 1000 });
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });

  it("continued sessions cancel pending cleanup and rebind emit to the new run's emitter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-emit-rebind-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "complete";
    const run1Events: string[] = [];
    const run2Events: string[] = [];
    // idleSettleMs=20 so the session becomes "done" quickly (reusable)
    // idleCleanupMs=500 so the process stays alive long enough to be reused
    const runner = new CodexAppServerRunner({ idleSettleMs: 20, idleCleanupMs: 500, terminalRetentionMs: 100, requestTimeoutMs: 400 });
    try {
      const first = await runner.start(makeInput(root, [process.execPath, script], {
        runId: "run-1",
        emitEvent: (type) => run1Events.push(type),
      }));

      // Wait for first run to reach done (settle fires after idleSettleMs=20ms)
      await vi.waitFor(async () => expect(await runner.status(first)).toMatchObject({ status: "done" }), { timeout: 500 });

      // Reuse session: continueTurn rebinds session.emit to run2's emitter.
      // The mock process (still alive, idleCleanupMs=500) will respond to the new turn/start.
      const second = await runner.start(makeInput(root, [process.execPath, script], {
        runId: "run-2",
        emitEvent: (type) => run2Events.push(type),
      }));

      // Same session (same process)
      expect(second.pid).toBe(first.pid);

      // Wait for second run to finish (mock responds to second turn/start with turn/completed)
      await vi.waitFor(async () => expect(await runner.status(second)).toMatchObject({ status: "done" }), { timeout: 500 });

      // Events from the second turn must go to run2Events, not run1Events.
      // worker.codex.turn.continued is emitted by continueTurn — always attributed to run2.
      expect(run2Events).toContain("worker.codex.turn.continued");

      // The second run's turn must have produced a completion event (prevents vacuous pass).
      expect(run2Events).toContain("worker.codex.turn.completed");

      // Events from the second turn/started → turn/completed cycle should not have leaked
      // back into run1's collector (the emit-closure bug would have put them there).
      // run1 may legitimately have one copy of each type from its own turn; a second copy
      // would indicate the old misattribution bug.
      for (const type of ["worker.codex.turn.completed", "worker.codex.message"]) {
        if (run2Events.includes(type)) {
          expect(run1Events.filter((e) => e === type).length).toBeLessThanOrEqual(1);
        }
      }
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });

  it("(watchdog) dropped item terminal event — watchdog unblocks settle and run reaches done", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-watchdog-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "dropped-item";
    const events: string[] = [];
    // maxItemAgeMs=50ms: watchdog fires 50ms after item/started (t≈55ms).
    // idleSettleMs=20ms: settle re-arms after watchdog and fires at t≈75ms → done.
    const runner = new CodexAppServerRunner({ idleSettleMs: 20, maxItemAgeMs: 50, idleCleanupMs: 500, terminalRetentionMs: 100 });
    try {
      const handle = await runner.start(makeInput(root, [process.execPath, script], {
        emitEvent: (type) => events.push(type),
      }));

      // At t=30ms: settle timer fired once but item is in-flight — must still be running
      await new Promise((r) => setTimeout(r, 30));
      expect(await runner.status(handle)).toMatchObject({ status: "running" });

      // After watchdog fires (t≈55ms) + settle window (20ms) → done
      await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "done" }), { timeout: 500 });

      // Watchdog expiry event must have been emitted
      expect(events).toContain("worker.codex.item.watchdog_expired");
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });

  it("(long-tool) in-flight item blocks settle — process not killed while item/started has no matching item/completed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alg204-long-tool-"));
    const script = await writeMockServer(root);
    process.env.MOCK_CODEX_MODE = "long-tool";
    // idleSettleMs=20ms: shorter than the 60ms item/completed delay, so without in-flight tracking
    // the timer would fire at t≈25ms and mark done while the tool is still running
    const runner = new CodexAppServerRunner({ idleSettleMs: 20, idleCleanupMs: 500, terminalRetentionMs: 100 });
    try {
      const handle = await runner.start(makeInput(root, [process.execPath, script]));

      // At t=30ms: settle timer has fired once (at t≈25ms) but item is in-flight — must still be running
      await new Promise((r) => setTimeout(r, 30));
      expect(await runner.status(handle)).toMatchObject({ status: "running" });

      // After item/completed (t=60ms) + another settle window (20ms) → done
      await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "done" }), { timeout: 500 });
    } finally {
      delete process.env.MOCK_CODEX_MODE;
      await runner.shutdown();
    }
  });
});
