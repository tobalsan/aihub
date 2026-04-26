import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { expandPath, type Extension, type ExtensionContext } from "@aihub/shared";

// ── Config ──────────────────────────────────────────────────────────

const BoardExtensionConfigSchema = z.object({
  /** Custom board workspace path (defaults to $AIHUB_HOME/extensions/board) */
  root: z.string().optional(),
  /** If true, board claims the home route (/) */
  home: z.boolean().default(true),
});


let extensionContext: ExtensionContext | null = null;
let boardRoot: string | null = null;

function getContext(): ExtensionContext {
  if (!extensionContext) throw new Error("Board extension not started");
  return extensionContext;
}

function getBoardRoot(): string {
  if (!boardRoot) throw new Error("Board root not initialized");
  return boardRoot;
}

function getScratchpadPath(): string {
  return path.join(getBoardRoot(), "SCRATCHPAD.md");
}

function readScratchpad(): { content: string; updatedAt: string } {
  const filePath = getScratchpadPath();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf-8");
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);
  return { content, updatedAt: stat.mtime.toISOString() };
}

function writeScratchpad(content: string): { updatedAt: string } {
  const filePath = getScratchpadPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
  const stat = fs.statSync(filePath);
  return { updatedAt: stat.mtime.toISOString() };
}

function resolveBoardRoot(ctx: ExtensionContext, rawConfig: unknown): string {
  const parsed = BoardExtensionConfigSchema.pick({ root: true }).parse(rawConfig);
  if (parsed.root) return expandPath(parsed.root);
  return path.join(ctx.getDataDir(), "extensions", "board");
}

// ── Simplified project statuses ─────────────────────────────────────

const BOARD_STATUSES = ["intent", "current", "review", "done"] as const;

// ── Routes ──────────────────────────────────────────────────────────

const registeredApps = new WeakSet<object>();

function registerBoardRoutes(app: Hono): void {
  if (registeredApps.has(app)) return;
  registeredApps.add(app);

  // Health / info
  app.get("/board/info", (c) => {
    const config = getContext().getConfig();
    const raw = config.extensions?.board ?? {};
    const parsed = BoardExtensionConfigSchema.parse(raw);
    return c.json({
      id: "board",
      home: parsed.home,
      root: getBoardRoot(),
      statuses: BOARD_STATUSES,
    });
  });

  // Canvas commands — agent tells the UI what to show
  // These are stored in a simple in-memory map per session
  // (Will evolve to persistent store later)
  const canvasState = new Map<string, { panel: string; props?: Record<string, unknown> }>();

  app.post("/board/canvas/:agentId", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json();
    const panel = typeof body.panel === "string" ? body.panel : "overview";
    const props =
      typeof body.props === "object" && body.props !== null
        ? body.props as Record<string, unknown>
        : undefined;

    canvasState.set(agentId, { panel, props });

    // Emit event so SSE subscribers know
    getContext().emit("canvas.updated", { agentId, panel, props });

    return c.json({ ok: true, agentId, panel, props });
  });

  app.get("/board/canvas/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const state = canvasState.get(agentId) ?? { panel: "overview" };
    return c.json(state);
  });

  // Project list (will be wired to board's own store)
  app.get("/board/projects", async (c) => {
    return c.json({ items: [], statuses: BOARD_STATUSES });
  });

  app.get("/board/agents", (c) => {
    const agents = getContext().getAgents();
    return c.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        description: a.description,
      })),
    });
  });

  app.get("/board/scratchpad", (c) => {
    const data = readScratchpad();
    return c.json(data);
  });

  app.put("/board/scratchpad", async (c) => {
    const body = await c.req.json();
    const content = typeof body.content === "string" ? body.content : "";
    const result = writeScratchpad(content);
    getContext().emit("scratchpad.updated", {
      updatedAt: result.updatedAt,
    });
    return c.json({ ok: true, ...result });
  });
}

// ── Extension definition ────────────────────────────────────────────

const boardExtension: Extension = {
  id: "board",
  displayName: "Board",
  description:
    "Two-pane workspace: agent chat + reactive canvas. Simplified project tracking for solo operators.",
  dependencies: [],
  configSchema: BoardExtensionConfigSchema,
  routePrefixes: [
    "/api/board",
  ],
  validateConfig(raw) {
    const result = BoardExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app) {
    registerBoardRoutes(app);
  },
  async start(ctx) {
    extensionContext = ctx;

    const config = ctx.getConfig();
    const raw = config.extensions?.board ?? {};
    boardRoot = resolveBoardRoot(ctx, raw);

    fs.mkdirSync(boardRoot, { recursive: true });
    console.log(`[board] extension started (root: ${boardRoot})`);
  },
  async stop() {
    extensionContext = null;
    boardRoot = null;
    console.log("[board] extension stopped");
  },
  getSystemPromptContributions() {
    return [
      "Board scratchpad tools:",
      "- scratchpad.read {} → Returns { content: string, updatedAt: string }. The shared scratchpad content.",
      "- scratchpad.write { content: string } → Replaces scratchpad content. Use for collaborative notes, brainstorms, status updates.",
    ].join("\n");
  },
  capabilities() {
    return ["board", "canvas"];
  },
};

export { boardExtension };
