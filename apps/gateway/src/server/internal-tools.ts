import { Hono } from "hono";
import { z } from "zod";

const InternalToolRequestSchema = z.object({
  tool: z.string(),
  args: z.unknown(),
  agentId: z.string(),
  agentToken: z.string(),
});

export const internalTools = new Hono();

internalTools.post("/tools", async (c) => {
  const body = await c.req.json();
  const parsed = InternalToolRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  return c.json({ error: "Not implemented" }, 501);
});
