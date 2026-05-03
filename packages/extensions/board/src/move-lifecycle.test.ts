import { describe, expect, it } from "vitest";
import {
  mapToLifecycleStatus,
  validateLifecycleTransition,
  readSliceProgress,
} from "./projects.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ── mapToLifecycleStatus ───────────────────────────────────────────

describe("mapToLifecycleStatus", () => {
  it("maps 'active' to 'active'", () => {
    expect(mapToLifecycleStatus("active")).toBe("active");
  });

  // §10.1: legacy project status 'todo' maps to 'active' (project is dispatch-ready)
  it("maps legacy in-flight statuses (including 'todo') to 'active'", () => {
    expect(mapToLifecycleStatus("todo")).toBe("active");
    expect(mapToLifecycleStatus("in_progress")).toBe("active");
    expect(mapToLifecycleStatus("review")).toBe("active");
    expect(mapToLifecycleStatus("ready_to_merge")).toBe("active");
  });

  it("maps pre-start statuses to 'shaping'", () => {
    expect(mapToLifecycleStatus("shaping")).toBe("shaping");
    expect(mapToLifecycleStatus("maybe")).toBe("shaping");
    expect(mapToLifecycleStatus("not_now")).toBe("shaping");
  });

  it("maps 'done' to 'done'", () => {
    expect(mapToLifecycleStatus("done")).toBe("done");
  });

  it("maps 'cancelled' to 'cancelled'", () => {
    expect(mapToLifecycleStatus("cancelled")).toBe("cancelled");
  });

  it("maps 'archived' to 'archived'", () => {
    expect(mapToLifecycleStatus("archived")).toBe("archived");
  });

  it("maps unknown status to 'shaping'", () => {
    expect(mapToLifecycleStatus("")).toBe("shaping");
    expect(mapToLifecycleStatus("something_else")).toBe("shaping");
  });
});

// ── validateLifecycleTransition ────────────────────────────────────

describe("validateLifecycleTransition", () => {
  it("accepts shaping → active", () => {
    expect(validateLifecycleTransition("shaping", "active")).toEqual({
      ok: true,
    });
  });

  it("accepts active → cancelled", () => {
    expect(validateLifecycleTransition("active", "cancelled")).toEqual({
      ok: true,
    });
  });

  it("accepts shaping → cancelled", () => {
    expect(validateLifecycleTransition("shaping", "cancelled")).toEqual({
      ok: true,
    });
  });

  it("accepts active → done when slices all terminal and ≥1 done", () => {
    // 3/3 terminal (done count in progress = terminal count)
    expect(
      validateLifecycleTransition("active", "done", { done: 3, total: 3 })
    ).toEqual({ ok: true });
    // 2/2 terminal
    expect(
      validateLifecycleTransition("active", "done", { done: 2, total: 2 })
    ).toEqual({ ok: true });
  });

  it("accepts active → done with no slices", () => {
    // No sliceProgress passed — allow
    expect(validateLifecycleTransition("active", "done")).toEqual({ ok: true });
    // Explicit empty slices
    expect(
      validateLifecycleTransition("active", "done", { done: 0, total: 0 })
    ).toEqual({ ok: true });
  });

  it("rejects active → done when slices not terminal", () => {
    // 1 terminal out of 3 — 2 still pending
    const result = validateLifecycleTransition("active", "done", {
      done: 1,
      total: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("slices_not_terminal");
      // 2 slices not yet finished
      expect(result.reason).toMatch(/2 slice/);
    }
  });

  it("rejects no_change transitions", () => {
    const result = validateLifecycleTransition("active", "active");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_change");
  });

  it("rejects moves from terminal statuses", () => {
    const fromDone = validateLifecycleTransition("done", "active");
    expect(fromDone.ok).toBe(false);
    if (!fromDone.ok) expect(fromDone.code).toBe("terminal_status");

    const fromCancelled = validateLifecycleTransition("cancelled", "shaping");
    expect(fromCancelled.ok).toBe(false);
    if (!fromCancelled.ok) expect(fromCancelled.code).toBe("terminal_status");

    const fromArchived = validateLifecycleTransition("archived", "active");
    expect(fromArchived.ok).toBe(false);
    if (!fromArchived.ok) expect(fromArchived.code).toBe("terminal_status");
  });

  it("rejects demotion active → shaping", () => {
    const result = validateLifecycleTransition("active", "shaping");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_transition");
  });

  it("rejects done → done (no_change)", () => {
    const result = validateLifecycleTransition("done", "done");
    // done is terminal so terminal_status fires first (before no_change check)
    expect(result.ok).toBe(false);
  });
});

// ── readSliceProgress ──────────────────────────────────────────────

describe("readSliceProgress", () => {
  let tmp: string;

  async function mkSlice(
    projectDir: string,
    sliceId: string,
    status: string
  ): Promise<void> {
    const sliceDir = path.join(projectDir, "slices", sliceId);
    await fs.mkdir(sliceDir, { recursive: true });
    await fs.writeFile(
      path.join(sliceDir, "README.md"),
      `---\nid: ${sliceId}\nstatus: ${status}\ntitle: Test\n---\n`,
      "utf-8"
    );
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "board-sliceprogress-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns 0/0 when no slices directory", async () => {
    const result = await readSliceProgress(tmp);
    expect(result).toEqual({ done: 0, total: 0 });
  });

  it("returns 0/0 for empty slices directory", async () => {
    await fs.mkdir(path.join(tmp, "slices"), { recursive: true });
    const result = await readSliceProgress(tmp);
    expect(result).toEqual({ done: 0, total: 0 });
  });

  it("counts total and done slices", async () => {
    await mkSlice(tmp, "PRO-001-S01", "todo");
    await mkSlice(tmp, "PRO-001-S02", "in_progress");
    await mkSlice(tmp, "PRO-001-S03", "done");
    await mkSlice(tmp, "PRO-001-S04", "cancelled");
    const result = await readSliceProgress(tmp);
    expect(result).toEqual({ done: 2, total: 4 });
  });

  it("only counts done and cancelled as terminal", async () => {
    await mkSlice(tmp, "PRO-002-S01", "ready_to_merge");
    await mkSlice(tmp, "PRO-002-S02", "review");
    await mkSlice(tmp, "PRO-002-S03", "done");
    const result = await readSliceProgress(tmp);
    expect(result).toEqual({ done: 1, total: 3 });
  });

  it("ignores non-slice directories", async () => {
    await mkSlice(tmp, "PRO-001-S01", "done");
    await fs.mkdir(path.join(tmp, "slices", "not-a-slice"), {
      recursive: true,
    });
    const result = await readSliceProgress(tmp);
    expect(result).toEqual({ done: 1, total: 1 });
  });
});
