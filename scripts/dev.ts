#!/usr/bin/env node
/**
 * Dev orchestrator: spawns gateway + web UI (if ui.enabled !== false)
 *
 * - Ensures only one Vite process (won't respawn on gateway restart)
 * - Uses AIHUB_SKIP_WEB env var to prevent double-spawn
 * - Forwards SIGINT/SIGTERM to both processes
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";

interface Config {
  ui?: {
    enabled?: boolean;
    port?: number;
    bind?: "loopback" | "lan" | "tailnet";
    tailscale?: { mode?: "off" | "serve" };
  };
}

function loadConfig(): Config {
  try {
    const configPath = path.join(os.homedir(), ".aihub", "aihub.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  const config = loadConfig();
  const uiEnabled = config.ui?.enabled !== false; // default true

  const rootDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const children: ChildProcess[] = [];

  // Start web UI (unless disabled or already spawned)
  if (uiEnabled && !process.env.AIHUB_SKIP_WEB) {
    console.log("[dev] Starting web UI...");
    const web = spawn("pnpm", ["--filter", "@aihub/web", "dev"], {
      stdio: "inherit",
      cwd: rootDir,
      env: process.env,
    });
    children.push(web);
  } else if (!uiEnabled) {
    console.log("[dev] Web UI disabled (ui.enabled: false)");
  }

  // Start gateway with tsx watch
  console.log("[dev] Starting gateway...");
  const gateway = spawn(
    "pnpm",
    ["--filter", "@aihub/gateway", "exec", "tsx", "watch", "src/cli/index.ts", "gateway"],
    {
      stdio: "inherit",
      cwd: rootDir,
      env: { ...process.env, AIHUB_SKIP_WEB: "1" },
    }
  );
  children.push(gateway);

  // Cleanup handler
  const cleanup = (signal: string) => {
    console.log(`\n[dev] Received ${signal}, shutting down...`);
    for (const child of children) {
      child.kill("SIGTERM");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));

  // Exit when gateway exits
  gateway.on("exit", (code) => {
    for (const child of children) {
      if (child !== gateway) child.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}

main();
