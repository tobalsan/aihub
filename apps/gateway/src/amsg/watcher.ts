import { spawn } from "node:child_process";
import { getActiveAgents } from "../config/index.js";
import { runAgent, getAllSessionsForAgent } from "../agents/index.js";

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
    // Skip agents without amsg config or with amsg disabled
    if (!agent.amsg || agent.amsg.enabled === false) continue;

    const amsgId = agent.amsg.id ?? agent.id;

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
          sessionId: `amsg:${agent.id}`,
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
