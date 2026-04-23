import { Hono } from "hono";
import { z } from "zod";
import {
  type Extension,
  type ExtensionContext,
  type GatewayConfig,
} from "@aihub/shared";

// ── Config ──────────────────────────────────────────────────────────

const BoardExtensionConfigSchema = z.object({
  /** Re-use the projects root for data storage */
  root: z.string().optional(),
  /** If true, board claims the home route (/) */
  home: z.boolean().default(true),
});

type BoardConfig = z.infer<typeof BoardExtensionConfigSchema>;

let extensionContext: ExtensionContext | null = null;

function getContext(): ExtensionContext {
  if (!extensionContext) throw new Error("Board extension not started");
  return extensionContext;
}

function getBoardConfig(): BoardConfig & { root: string } {
  const config = getContext().getConfig();
  const raw = config.extensions?.board ?? {};
  const parsed = BoardExtensionConfigSchema.parse(raw);
  const root = parsed.root ?? "~/projects";
  return { ...parsed, root };
}

// ── Simplified project statuses ─────────────────────────────────────

const BOARD_STATUSES = ["intent", "current", "review", "done"] as const;
type BoardStatus = (typeof BOARD_STATUSES)[number];

const BoardStatusSchema = z.enum(BOARD_STATUSES);

// ── Routes ──────────────────────────────────────────────────────────

const registeredApps = new WeakSet<object>();

function registerBoardRoutes(app: Hono): void {
  if (registeredApps.has(app)) return;
  registeredApps.add(app);

  // Health / info
  app.get("/board/info", (c) => {
    const config = getBoardConfig();
    return c.json({
      id: "board",
      home: config.home,
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
    console.log("[board] extension started");
  },
  async stop() {
    extensionContext = null;
    console.log("[board] extension stopped");
  },
  capabilities() {
    return ["board", "canvas"];
  },
};

export { boardExtension };
