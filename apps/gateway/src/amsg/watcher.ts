import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getActiveAgents, resolveWorkspaceDir } from "../config/index.js";
import { runAgent, getAllSessionsForAgent } from "../agents/index.js";
import type { AgentConfig } from "@aihub/shared";

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

let timer: NodeJS.Timeout | null = null;

// Track seen messages: stable IDs when JSON available, timestamp-based otherwise
const seenMessageIds = new Map<string, Set<string>>();
// Timestamp of last successful trigger per agent (for non-JSON fallback)
const lastTriggerTime = new Map<string, number>();

async function runAmsgCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("amsg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `amsg exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

type InboxCheckResult = {
  hasNew: boolean;
  messageIds: string[] | null; // null if JSON not available
};

type AmsgInfoFile = {
  id: string;
};

/**
 * Resolve amsg ID for an agent.
 * Priority: workspace/.amsg-info > agent.amsg.id > agent.id
 * Returns null if .amsg-info is absent (agent not registered).
 */
async function resolveAmsgId(agent: AgentConfig): Promise<string | null> {
  const workspaceDir = resolveWorkspaceDir(agent.workspace);
  const infoPath = path.join(workspaceDir, ".amsg-info");

  try {
    const content = await fs.readFile(infoPath, "utf-8");
    const info: AmsgInfoFile = JSON.parse(content);
    if (info.id && typeof info.id === "string") {
      // Warn if config id differs from .amsg-info
      if (agent.amsg?.id && agent.amsg.id !== info.id) {
        console.warn(
          `[amsg] Agent ${agent.id}: config amsg.id "${agent.amsg.id}" differs from .amsg-info "${info.id}", using .amsg-info`
        );
      }
      return info.id;
    }
    // File exists but invalid format
    console.warn(`[amsg] Agent ${agent.id}: .amsg-info missing 'id' field, skipping`);
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // .amsg-info doesn't exist - agent not registered
      return null;
    }
    // File exists but can't be parsed
    console.warn(`[amsg] Agent ${agent.id}: Failed to read .amsg-info:`, err);
    return null;
  }
}

async function checkInbox(amsgId: string): Promise<InboxCheckResult> {
  try {
    // Try JSON format first: amsg inbox --new -a <amsgId> --json
    const output = await runAmsgCommand(["inbox", "--new", "-a", amsgId, "--json"]);
    if (!output || output.trim() === "" || output.includes("No new messages")) {
      return { hasNew: false, messageIds: [] };
    }
    // Parse JSON output - expect array of message objects with id
    const messages = JSON.parse(output);
    if (!Array.isArray(messages)) return { hasNew: false, messageIds: [] };
    const ids = messages
      .filter((m): m is { id: string } => m && typeof m.id === "string")
      .map((m) => m.id);
    return { hasNew: ids.length > 0, messageIds: ids };
  } catch {
    // JSON not available - fall back to plain text check
    try {
      const output = await runAmsgCommand(["inbox", "--new", "-a", amsgId]);
      if (!output || output.includes("No new messages") || output.trim() === "") {
        return { hasNew: false, messageIds: null };
      }
      // Has new messages but can't get stable IDs
      return { hasNew: true, messageIds: null };
    } catch {
      return { hasNew: false, messageIds: null };
    }
  }
}

async function checkAllAgents() {
  const agents = getActiveAgents();

  for (const agent of agents) {
    // Skip agents with amsg explicitly disabled
    if (agent.amsg?.enabled === false) continue;

    // Resolve amsg ID from .amsg-info (source of truth)
    const amsgId = await resolveAmsgId(agent);
    if (!amsgId) continue; // Agent not registered with amsg

    try {
      const result = await checkInbox(amsgId);
      if (!result.hasNew) continue;

      // Skip if agent is currently streaming on ANY session - don't interrupt
      const allSessions = getAllSessionsForAgent(agent.id);
      if (allSessions.some((s) => s.isStreaming)) {
        continue;
      }

      let shouldTrigger = false;

      if (result.messageIds !== null) {
        // JSON available - use stable message IDs
        if (!seenMessageIds.has(agent.id)) {
          seenMessageIds.set(agent.id, new Set());
        }
        const seen = seenMessageIds.get(agent.id)!;
        const newIds = result.messageIds.filter((id) => !seen.has(id));

        if (newIds.length > 0) {
          shouldTrigger = true;
          for (const id of newIds) {
            seen.add(id);
          }
          console.log(`[amsg] ${newIds.length} new message(s) for agent: ${agent.id}`);
        }
      } else {
        // No JSON - use timestamp-based throttling
        // Only trigger if we haven't triggered in the last 5 minutes
        const lastTrigger = lastTriggerTime.get(agent.id) ?? 0;
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

        if (lastTrigger < fiveMinutesAgo) {
          shouldTrigger = true;
          console.log(`[amsg] New message(s) detected for agent: ${agent.id} (no JSON, using throttle)`);
        }
      }

      if (shouldTrigger) {
        lastTriggerTime.set(agent.id, Date.now());

        // Send a message to the agent telling them to check inbox
        // The agent is responsible for pull/ack
        await runAgent({
          agentId: agent.id,
          message: "You have new messages in your amsg inbox. Please check with `amsg inbox --new` and process them.",
          sessionKey: "main",
        });
      }
    } catch (err) {
      console.error(`[amsg] Error checking inbox for ${agent.id}:`, err);
    }
  }
}

export function startAmsgWatcher() {
  // Check immediately
  checkAllAgents().catch((err) => {
    console.error("[amsg] Initial check failed:", err);
  });

  // Then check every minute
  timer = setInterval(() => {
    checkAllAgents().catch((err) => {
      console.error("[amsg] Periodic check failed:", err);
    });
  }, CHECK_INTERVAL_MS);

  timer.unref?.();
  console.log("[amsg] Watcher started");
}

export function stopAmsgWatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  console.log("[amsg] Watcher stopped");
}
