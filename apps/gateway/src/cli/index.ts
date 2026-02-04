#!/usr/bin/env node
import { Command } from "commander";
import { spawn, ChildProcess, execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { loadConfig, getAgents, getAgent, setSingleAgentMode, CONFIG_DIR } from "../config/index.js";
import { startServer } from "../server/index.js";
import { startDiscordBots, stopDiscordBots } from "../discord/index.js";
import { startScheduler, stopScheduler } from "../scheduler/index.js";
import { startAmsgWatcher, stopAmsgWatcher } from "../amsg/index.js";
import { startAllHeartbeats, stopAllHeartbeats } from "../heartbeat/index.js";
import { runAgent } from "../agents/index.js";
import { registerSubagentCommands } from "./subagent.js";
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

function pickTailnetIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const octets = addr.address.split(".").map(Number);
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}

function getTailscaleIP(): string | null {
  try {
    const output = execSync("tailscale status --json", { encoding: "utf-8", timeout: 5000 });
    const status = JSON.parse(output);
    const ips = status?.Self?.TailscaleIPs as string[] | undefined;
    return ips?.find((ip: string) => !ip.includes(":")) ?? ips?.[0] ?? null;
  } catch {
    return null;
  }
}

function resolveBindHost(bind?: GatewayBindMode): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  if (bind === "tailnet") {
    return pickTailnetIPv4() ?? getTailscaleIP() ?? "127.0.0.1";
  }
  return "127.0.0.1";
}

function getApiBaseUrl(): string {
  const envUrl = process.env.AIHUB_API_URL;
  if (envUrl) return envUrl;

  const config = loadConfig();
  const host = config.gateway?.host ?? resolveBindHost(config.gateway?.bind);
  const port = config.gateway?.port ?? 4000;
  return `http://${host}:${port}`;
}

function startWebUI(uiConfig: UiConfig): ChildProcess | null {
  if (process.env.AIHUB_SKIP_WEB) return null;

  const port = uiConfig.port ?? 3000;
  const host = resolveUiHost(uiConfig.bind);
  const useTailscaleServe = uiConfig.tailscale?.mode === "serve";
  const useDevServer = process.env.AIHUB_WEB_DEV === "1";

  // Get monorepo root (gateway is at apps/gateway/dist/cli or apps/gateway/src/cli)
  const gatewayRoot = path.resolve(__dirname, "../..");
  const monorepoRoot = path.resolve(gatewayRoot, "../..");

  // Use vite dev for hot reload, vite preview for production-like serving
  const viteCmd = useDevServer ? "dev" : "preview";
  const args = ["--filter", "@aihub/web", "exec", "vite", viteCmd, "--port", String(port), "--host", host];
  const child = spawn("pnpm", args, {
    cwd: monorepoRoot,
    stdio: "inherit",
    env: { ...process.env, AIHUB_SKIP_WEB: "1" },
  });

  // Log URL
  if (useTailscaleServe) {
    console.log(`Web UI: https://<tailnet>/aihub (via tailscale serve)`);
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

function printDevBanner(gatewayPort: number, uiPort: number | null) {
  const uiLine = uiPort ? `║  Web UI:  http://127.0.0.1:${uiPort.toString().padEnd(5)}       ║` : null;
  console.log(`
╔════════════════════════════════════════╗
║           DEV MODE ACTIVE              ║
║  Gateway: http://127.0.0.1:${gatewayPort.toString().padEnd(5)}       ║${uiLine ? `\n${uiLine}` : ""}
║  Discord/Scheduler/Heartbeat: OFF      ║
╚════════════════════════════════════════╝
`);
}

program
  .command("gateway")
  .description("Start the gateway server (multi-agent mode)")
  .option("-p, --port <port>", "Server port (default: 4000 or config)")
  .option("-h, --host <host>", "Server host (default: from config gateway.bind)")
  .option("--agent-id <id>", "Single-agent mode: only load this agent")
  .option("--dev", "Dev mode: auto-find ports, disable Discord/scheduler/heartbeat/amsg")
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

      // In dev mode, set AIHUB_DEV env var for child processes
      if (opts.dev) {
        process.env.AIHUB_DEV = "1";
      }

      // Start server (undefined args let startServer use config defaults)
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      startServer(port, opts.host);

      // Resolve actual port for banner
      const actualPort = port ?? config.gateway?.port ?? 4000;
      const uiPort = config.ui?.port ?? 3000;

      // Start web UI if enabled (default: true) and not in dev mode
      // In dev mode, web UI is started by scripts/dev.ts with proper port coordination
      const uiEnabled = config.ui?.enabled !== false;
      if (uiEnabled && !opts.dev) {
        webProcess = startWebUI(config.ui ?? {});
      }

      // In dev mode, skip external services and show banner
      if (opts.dev) {
        printDevBanner(actualPort, uiEnabled ? uiPort : null);
      } else {
        // Start Discord bots
        await startDiscordBots();

        // Start scheduler
        await startScheduler();

        // Start amsg watcher
        startAmsgWatcher();

        // Start heartbeats
        startAllHeartbeats();
      }

      // Handle shutdown
      const shutdown = async () => {
        console.log("\nShutting down...");
        if (webProcess) webProcess.kill("SIGTERM");
        if (!opts.dev) {
          stopAllHeartbeats();
          stopAmsgWatcher();
          await stopScheduler();
          await stopDiscordBots();
        }
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

program
  .command("heartbeat <agentId>")
  .description("Trigger a heartbeat for an agent")
  .action(async (agentId: string) => {
    try {
      loadConfig();
      const agent = getAgent(agentId);
      if (!agent) {
        console.error(`Agent not found: ${agentId}`);
        process.exit(1);
      }

      console.log(`Running heartbeat for ${agent.name}...`);
      const baseUrl = getApiBaseUrl();
      const url = new URL(`/api/agents/${agentId}/heartbeat`, baseUrl).toString();
      let res;
      try {
        res = await fetch(url, { method: "POST" });
      } catch {
        console.error(`Failed to reach gateway at ${baseUrl}`);
        process.exit(1);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to run heartbeat" }));
        console.error(data.error ?? "Failed to run heartbeat");
        process.exit(1);
      }
      const result = (await res.json()) as {
        status?: string;
        durationMs?: number;
        reason?: string;
        alertText?: string;
      };

      console.log(`Status: ${result.status}`);
      if (result.durationMs !== undefined) {
        console.log(`Duration: ${result.durationMs}ms`);
      }
      if (result.reason) {
        console.log(`Reason: ${result.reason}`);
      }
      if (result.alertText) {
        console.log(`\n${result.alertText}`);
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

registerSubagentCommands(program);

// Auth commands
const authCmd = program.command("auth").description("Manage OAuth authentication");

authCmd
  .command("login [provider]")
  .description("Login to an OAuth provider (run without args to see available providers)")
  .action(async (provider?: string) => {
    try {
      const { AuthStorage } = await import("@mariozechner/pi-coding-agent");
      const { getOAuthProviders } = await import("@mariozechner/pi-ai");
      const authStorage = new AuthStorage(path.join(CONFIG_DIR, "auth.json"));
      const providers = getOAuthProviders();

      // If no provider specified, show menu
      let selectedProvider = provider;
      if (!selectedProvider) {
        console.log("Select a provider:\n");
        providers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
        console.log();

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const choice = await new Promise<string>((resolve) =>
          rl.question("Enter number: ", resolve)
        );
        rl.close();

        const index = parseInt(choice, 10) - 1;
        if (index < 0 || index >= providers.length) {
          console.error("Invalid selection");
          process.exit(1);
        }
        selectedProvider = providers[index].id;
      }

      // Validate provider
      const providerInfo = providers.find((p) => p.id === selectedProvider);
      if (!providerInfo) {
        console.error(`Unknown provider: ${selectedProvider}`);
        console.error(`Available: ${providers.map((p) => p.id).join(", ")}`);
        process.exit(1);
      }

      console.log(`Logging in to ${providerInfo.name}...`);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await authStorage.login(selectedProvider as Parameters<typeof authStorage.login>[0], {
        onAuth: (info) => {
          console.log(`\nOpen this URL in your browser:\n${info.url}`);
          if (info.instructions) console.log(info.instructions);
          console.log();
        },
        onPrompt: async (prompt) => {
          return new Promise((resolve) =>
            rl.question(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `, resolve)
          );
        },
        onProgress: (msg) => console.log(msg),
      });
      rl.close();

      console.log(`\nLogged in to ${providerInfo.name}`);
    } catch (err) {
      console.error("Login failed:", err);
      process.exit(1);
    }
  });

authCmd
  .command("status")
  .description("Show authentication status")
  .action(async () => {
    try {
      const { AuthStorage } = await import("@mariozechner/pi-coding-agent");
      const authStorage = new AuthStorage(path.join(CONFIG_DIR, "auth.json"));
      const providers = authStorage.list();

      if (providers.length === 0) {
        console.log("No providers authenticated. Run 'aihub auth login' to authenticate.");
        return;
      }

      console.log("Authenticated providers:");
      for (const provider of providers) {
        const cred = authStorage.get(provider);
        if (!cred) continue;
        if (cred.type === "oauth") {
          const expires = new Date((cred as { expires: number }).expires);
          const isExpired = expires.getTime() < Date.now();
          console.log(`  - ${provider} (oauth) expires: ${expires.toLocaleString()}${isExpired ? " [EXPIRED]" : ""}`);
        } else {
          console.log(`  - ${provider} (${cred.type})`);
        }
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

authCmd
  .command("logout <provider>")
  .description("Logout from a provider")
  .action(async (provider: string) => {
    try {
      const { AuthStorage } = await import("@mariozechner/pi-coding-agent");
      const authStorage = new AuthStorage(path.join(CONFIG_DIR, "auth.json"));

      if (!authStorage.has(provider)) {
        console.log(`Not logged in to ${provider}`);
        return;
      }

      authStorage.logout(provider);
      console.log(`Logged out from ${provider}`);
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program.parse();
