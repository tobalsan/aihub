import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getActiveAgents, resolveWorkspaceDir } from "../config/index.js";
import { runAgent, getAllSessionsForAgent } from "../agents/index.js";
import type { AgentConfig } from "@aihub/shared";

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

let timer: NodeJS.Timeout | null = null;

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

type AmsgInfoFile = {
  agent_id: string;
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
    if (info.agent_id && typeof info.agent_id === "string") {
      // Warn if config id differs from .amsg-info
      if (agent.amsg?.id && agent.amsg.id !== info.agent_id) {
        console.warn(
          `[amsg] Agent ${agent.id}: config amsg.id "${agent.amsg.id}" differs from .amsg-info "${info.agent_id}", using .amsg-info`
        );
      }
      return info.agent_id;
    }
    // File exists but invalid format
    console.warn(`[amsg] Agent ${agent.id}: .amsg-info missing 'agent_id' field, skipping`);
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

/**
 * Check if agent has new messages in inbox.
 */
async function hasNewMessages(amsgId: string): Promise<boolean> {
  try {
    const output = await runAmsgCommand(["inbox", "--new", "-a", amsgId]);
    // "No new messages for <id>" means empty
    return !!output && !output.includes("No new messages");
  } catch {
    return false;
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
      if (!(await hasNewMessages(amsgId))) continue;

      // Skip if agent is currently streaming on ANY session - don't interrupt
      const allSessions = getAllSessionsForAgent(agent.id);
      if (allSessions.some((s) => s.isStreaming)) {
        continue;
      }

      console.log(`[amsg] New message(s) for agent: ${agent.id}`);

      // Notify agent to check inbox - agent handles pull/ack
      await runAgent({
        agentId: agent.id,
        message: "You have new messages in your amsg inbox. Please check with `amsg inbox --new` and process them.",
        sessionKey: "main",
      });
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
