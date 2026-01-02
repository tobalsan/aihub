#!/usr/bin/env node
import { Command } from "commander";
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, getAgents, getAgent, setSingleAgentMode } from "../config/index.js";
import { startServer } from "../server/index.js";
import { startDiscordBots, stopDiscordBots } from "../discord/index.js";
import { startScheduler, stopScheduler } from "../scheduler/index.js";
import { startAmsgWatcher, stopAmsgWatcher } from "../amsg/index.js";
import { runAgent } from "../agents/index.js";
import type { UiConfig, GatewayBindMode } from "@aihub/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tracks web UI child process for cleanup
let webProcess: ChildProcess | null = null;

function resolveUiHost(bind?: string): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  // For tailnet bind with tailscale serve, Vite preview must bind to loopback
  return "127.0.0.1";
}

function startWebUI(uiConfig: UiConfig): ChildProcess | null {
  if (process.env.AIHUB_SKIP_WEB) return null;

  const port = uiConfig.port ?? 3000;
  const host = resolveUiHost(uiConfig.bind);
  const useTailscaleServe = uiConfig.tailscale?.mode === "serve";

  // Get monorepo root (gateway is at apps/gateway/dist/cli or apps/gateway/src/cli)
  const gatewayRoot = path.resolve(__dirname, "../..");
  const monorepoRoot = path.resolve(gatewayRoot, "../..");

  const args = ["--filter", "@aihub/web", "exec", "vite", "preview", "--port", String(port), "--host", host];
  const child = spawn("pnpm", args, {
    cwd: monorepoRoot,
    stdio: "inherit",
    env: { ...process.env, AIHUB_SKIP_WEB: "1" },
  });

  // Log URL
  if (useTailscaleServe) {
    console.log(`Web UI: https://<tailnet>/ (via tailscale serve)`);
  } else {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Web UI: http://${displayHost}:${port}/`);
  }

  return child;
}

const program = new Command();

program
  .name("aihub")
  .description("AIHub multi-agent gateway")
  .version("0.1.0");

program
  .command("gateway")
  .description("Start the gateway server (multi-agent mode)")
  .option("-p, --port <port>", "Server port (default: 4000 or config)")
  .option("-h, --host <host>", "Server host (default: from config gateway.bind)")
  .option("--agent-id <id>", "Single-agent mode: only load this agent")
  .action(async (opts) => {
    try {
      const config = loadConfig();
      console.log(`Loaded config with ${config.agents.length} agent(s)`);

      if (opts.agentId) {
        const agent = getAgent(opts.agentId);
        if (!agent) {
          console.error(`Agent not found: ${opts.agentId}`);
          process.exit(1);
        }
        setSingleAgentMode(opts.agentId);
        console.log(`Single-agent mode: ${agent.name} (${agent.id})`);
      }

      // Start server (undefined args let startServer use config defaults)
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      startServer(port, opts.host);

      // Start web UI if enabled (default: true)
      const uiEnabled = config.ui?.enabled !== false;
      if (uiEnabled) {
        webProcess = startWebUI(config.ui ?? {});
      }

      // Start Discord bots
      await startDiscordBots();

      // Start scheduler
      await startScheduler();

      // Start amsg watcher
      startAmsgWatcher();

      // Handle shutdown
      const shutdown = async () => {
        console.log("\nShutting down...");
        if (webProcess) webProcess.kill("SIGTERM");
        stopAmsgWatcher();
        await stopScheduler();
        await stopDiscordBots();
        process.exit(0);
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    } catch (err) {
      console.error("Failed to start gateway:", err);
      process.exit(1);
    }
  });

program
  .command("agent")
  .description("Manage agents")
  .command("list")
  .description("List all configured agents")
  .action(() => {
    try {
      const agents = getAgents();
      console.log("Configured agents:");
      for (const agent of agents) {
        console.log(`  - ${agent.id}: ${agent.name} (${agent.model.provider}/${agent.model.model})`);
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program
  .command("send")
  .description("Send a message to an agent")
  .requiredOption("-a, --agent <id>", "Agent ID")
  .requiredOption("-m, --message <text>", "Message to send")
  .option("-s, --session <id>", "Session ID", "default")
  .action(async (opts) => {
    try {
      const agent = getAgent(opts.agent);
      if (!agent) {
        console.error(`Agent not found: ${opts.agent}`);
        process.exit(1);
      }

      console.log(`Sending to ${agent.name}...`);
      const result = await runAgent({
        agentId: agent.id,
        message: opts.message,
        sessionId: opts.session,
        onEvent: (event) => {
          if (event.type === "text") {
            process.stdout.write(event.data);
          }
        },
      });

      console.log("\n");
      console.log(`Duration: ${result.meta.durationMs}ms`);
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program.parse();
