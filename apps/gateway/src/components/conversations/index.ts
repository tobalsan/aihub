import {
  ConversationsComponentConfigSchema,
  CreateConversationProjectRequestSchema,
  PostConversationMessageRequestSchema,
  type Component,
} from "@aihub/shared";
import type { Hono } from "hono";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { loadConfig, getActiveAgents } from "../../config/index.js";
import { runAgent } from "../../agents/index.js";
import {
  appendConversationMessage,
  getConversation,
  listConversations,
  resolveConversationAttachment,
} from "../../conversations/index.js";
import type { ConversationDetail } from "../../conversations/index.js";
import {
  appendProjectComment,
  createProject,
  updateProject,
} from "../../projects/index.js";
import { recordCommentActivity } from "../../activity/index.js";

const conversationsComponent: Component = {
  id: "conversations",
  displayName: "Conversations",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: ["/api/conversations"],
  validateConfig(raw) {
    const result = ConversationsComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app: Hono) {
    app.get("/conversations", async (c) => {
      const config = loadConfig();
      const result = await listConversations(config, {
        q: c.req.query("q"),
        source: c.req.query("source"),
        tag: c.req.query("tag"),
        participant: c.req.query("participant"),
      });
      if (!result.ok) {
        return c.json({ error: result.error }, 400);
      }
      return c.json(result.data);
    });

    app.get("/conversations/:id", async (c) => {
      const config = loadConfig();
      const result = await getConversation(config, c.req.param("id"));
      if (!result.ok) {
        return c.json({ error: result.error }, 404);
      }
      return c.json(result.data);
    });

    app.post("/conversations/:id/messages", async (c) => {
      const id = c.req.param("id");
      const config = loadConfig();
      const existing = await getConversation(config, id);
      if (!existing.ok) {
        return c.json({ error: existing.error }, 404);
      }

      const body = await c.req.json();
      const parsed = PostConversationMessageRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      const userMessage = parsed.data.message.trim();
      if (!userMessage) {
        return c.json({ error: "message is required" }, 400);
      }

      const userTimestamp = formatClockTime(new Date());
      const appendedUser = await appendConversationMessage(config, id, {
        speaker: "User",
        timestamp: userTimestamp,
        body: userMessage,
      });
      if (!appendedUser.ok) {
        return c.json({ error: appendedUser.error }, 400);
      }

      const mentions = extractMentions(userMessage);
      const forDispatch = await getConversation(config, id);
      if (!forDispatch.ok) {
        return c.json({ error: forDispatch.error }, 404);
      }
      const dispatchPrompt = [
        "Conversation thread context:",
        forDispatch.data.content.trim(),
        "",
        "Latest user message:",
        userMessage,
      ]
        .join("\n")
        .trim();
      const dispatches: Array<{
        mention: MentionTarget;
        status: "ok" | "error";
        agentId?: string;
        sdk?: string;
        error?: string;
        replies: string[];
      }> = [];

      for (const mention of mentions) {
        const resolved = resolveMentionAgent(mention);
        if (!resolved.ok) {
          dispatches.push({
            mention,
            status: "error",
            error: resolved.error,
            replies: [],
          });
          continue;
        }

        try {
          const run = await runAgent({
            agentId: resolved.data.id,
            message: dispatchPrompt,
            sessionKey: `conversation:${id}:${mention}`,
          });
          const replies = run.payloads
            .map((payload) => payload.text?.trim() ?? "")
            .filter(Boolean);

          for (const reply of replies) {
            const agentTimestamp = formatClockTime(new Date());
            const appendedReply = await appendConversationMessage(config, id, {
              speaker: resolved.data.name || toSpeakerName(mention),
              timestamp: agentTimestamp,
              body: reply,
            });
            if (!appendedReply.ok) {
              dispatches.push({
                mention,
                status: "error",
                agentId: resolved.data.id,
                sdk: resolved.data.sdk,
                error: appendedReply.error,
                replies: [],
              });
              continue;
            }
          }

          dispatches.push({
            mention,
            status: "ok",
            agentId: resolved.data.id,
            sdk: resolved.data.sdk,
            replies,
          });
        } catch (err) {
          dispatches.push({
            mention,
            status: "error",
            agentId: resolved.data.id,
            sdk: resolved.data.sdk,
            error: err instanceof Error ? err.message : String(err),
            replies: [],
          });
        }
      }

      const updated = await getConversation(config, id);
      if (!updated.ok) {
        return c.json({ error: updated.error }, 404);
      }

      return c.json({
        conversation: updated.data,
        mentions,
        dispatches,
        ui: {
          shouldRefresh: true,
          isThinking: false,
          pendingMentions: [],
        },
      });
    });

    app.get("/conversations/:id/attachments/:name", async (c) => {
      const id = c.req.param("id");
      const name = c.req.param("name");
      const config = loadConfig();
      const result = await resolveConversationAttachment(config, id, name);
      if (!result.ok) {
        return c.json({ error: result.error }, 404);
      }

      const type = attachmentContentType(result.data.name);
      c.header("Content-Type", type);
      return c.body(
        Readable.toWeb(
          createReadStream(result.data.path)
        ) as unknown as ReadableStream
      );
    });

    app.post("/conversations/:id/projects", async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = CreateConversationProjectRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      const config = loadConfig();
      const conversation = await getConversation(config, id);
      if (!conversation.ok) {
        return c.json({ error: conversation.error }, 404);
      }

      const nextTitle = parsed.data.title?.trim() || conversation.data.title;
      const created = await createProject(config, {
        title: nextTitle,
        status: "shaping",
      });
      if (!created.ok) {
        return c.json({ error: created.error }, 400);
      }

      const inception = buildConversationInception(conversation.data);
      const updated = await updateProject(config, created.data.id, {
        docs: { INCEPTION: inception },
      });
      if (!updated.ok) {
        return c.json({ error: updated.error }, 400);
      }

      const comment = await appendProjectComment(config, created.data.id, {
        author: "system",
        date: formatThreadDate(new Date()),
        body: `Created from conversation ${id}`,
      });
      if (!comment.ok) {
        return c.json({ error: comment.error }, 400);
      }
      await recordCommentActivity({
        actor: "system",
        projectId: created.data.id,
        commentExcerpt: `Created from conversation ${id}`,
      });

      return c.json(updated.data, 201);
    });
  },
  async start() {},
  async stop() {},
  capabilities() {
    return ["conversations"];
  },
};

function attachmentContentType(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function formatThreadDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClockTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type MentionTarget = "cloud" | "codex" | "claude" | "pi";

function extractMentions(input: string): MentionTarget[] {
  const found: MentionTarget[] = [];
  const seen = new Set<MentionTarget>();
  const pattern = /@(cloud|codex|claude|pi)\b/gi;
  for (const match of input.matchAll(pattern)) {
    const target = (match[1] ?? "").toLowerCase() as MentionTarget;
    if (!seen.has(target)) {
      seen.add(target);
      found.push(target);
    }
  }
  return found;
}

function toSpeakerName(target: MentionTarget): string {
  if (target === "cloud") return "Cloud";
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  return "Pi";
}

function resolveMentionAgent(
  target: MentionTarget
):
  | { ok: true; data: { id: string; name: string; sdk: string } }
  | { ok: false; error: string } {
  const agents = getActiveAgents();
  const byIdOrName = (name: string) =>
    agents.find((agent) => {
      const id = agent.id.trim().toLowerCase();
      const label = agent.name.trim().toLowerCase();
      return id === name || label === name;
    });

  if (target === "cloud") {
    const namedCloud = byIdOrName("cloud");
    if (namedCloud) {
      if ((namedCloud.sdk ?? "pi") !== "openclaw") {
        return { ok: false, error: "@cloud agent must use openclaw sdk" };
      }
      return {
        ok: true,
        data: {
          id: namedCloud.id,
          name: namedCloud.name || "Cloud",
          sdk: namedCloud.sdk ?? "pi",
        },
      };
    }
    const openclaw = agents.find((agent) => (agent.sdk ?? "pi") === "openclaw");
    if (!openclaw) {
      return { ok: false, error: "No openclaw agent available for @cloud" };
    }
    return {
      ok: true,
      data: {
        id: openclaw.id,
        name: openclaw.name || "Cloud",
        sdk: openclaw.sdk ?? "pi",
      },
    };
  }

  const matched = byIdOrName(target);
  if (!matched) return { ok: false, error: `No agent found for @${target}` };
  return {
    ok: true,
    data: {
      id: matched.id,
      name: matched.name || toSpeakerName(target),
      sdk: matched.sdk ?? "pi",
    },
  };
}

function buildConversationInception(conversation: ConversationDetail): string {
  const participants = conversation.participants.length
    ? conversation.participants.join(", ")
    : "none";
  const tags = conversation.tags.length
    ? conversation.tags.map((tag) => `#${tag}`).join(" ")
    : "none";
  const attachments = conversation.attachments.length
    ? conversation.attachments.map((name) => `- ${name}`).join("\n")
    : "- none";
  const transcript = conversation.content.trim() || "_No transcript content._";

  return [
    "# Inception",
    "",
    "## Source conversation",
    `- id: ${conversation.id}`,
    `- title: ${conversation.title}`,
    `- date: ${conversation.date ?? "unknown"}`,
    `- source: ${conversation.source ?? "unknown"}`,
    `- participants: ${participants}`,
    `- tags: ${tags}`,
    "",
    "## Attachments",
    attachments,
    "",
    "## Transcript",
    transcript,
    "",
  ].join("\n");
}

export { conversationsComponent };
