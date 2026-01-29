#!/usr/bin/env node
/**
 * Dev launcher for web UI with optional Tailscale HTTPS support.
 *
 * Reads ~/.aihub/aihub.json for ui config:
 * - ui.port: dev server port (default 3000)
 * - ui.bind: "loopback" | "lan" | "tailnet"
 * - ui.tailscale.mode: "off" | "serve" (enables HTTPS via tailscale serve)
 * - ui.tailscale.resetOnExit: reset tailscale serve on exit (default true)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getTailnetHostname, enableTailscaleServe, disableTailscaleServe } from "./tailscale.js";

type UiBindMode = "loopback" | "lan" | "tailnet";

interface UiConfig {
  port?: number;
  bind?: UiBindMode;
  tailscale?: {
    mode?: "off" | "serve";
    resetOnExit?: boolean;
  };
}

function loadUiConfig(): UiConfig {
  try {
    const configPath = path.join(os.homedir(), ".aihub", "aihub.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return config.ui ?? {};
  } catch {
    return {};
  }
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

function resolveHost(bind?: UiBindMode): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  if (bind === "tailnet") {
    const ip = pickTailnetIPv4();
    if (ip) return ip;
    console.warn("[dev] tailnet bind: no tailnet IP found, falling back to 127.0.0.1");
    return "127.0.0.1";
  }
  return "127.0.0.1";
}

async function main() {
  const uiConfig = loadUiConfig();
  const port = uiConfig.port ?? 3000;
  const host = resolveHost(uiConfig.bind);
  const tailscaleMode = uiConfig.tailscale?.mode ?? "off";
  const resetOnExit = uiConfig.tailscale?.resetOnExit ?? true;

  let tailscaleHostname: string | null = null;

  // Enable tailscale serve if configured
  if (tailscaleMode === "serve") {
    try {
      console.log(`[dev] Enabling Tailscale serve on port ${port} (path /aihub)...`);
      enableTailscaleServe(port, "/aihub");
      tailscaleHostname = getTailnetHostname();
      console.log(`[dev] HTTPS available at: https://${tailscaleHostname}/aihub`);
    } catch (err) {
      console.error("[dev] Failed to enable Tailscale serve:", err);
      console.log("[dev] Continuing without HTTPS...");
    }
  }

  // Spawn vite dev server
  const vite = spawn("pnpm", ["exec", "vite"], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Vite reads host/port from config, but we can override via env if needed
    },
    cwd: path.dirname(path.dirname(new URL(import.meta.url).pathname)),
  });

  // Cleanup on exit
  const cleanup = () => {
    if (tailscaleMode === "serve" && resetOnExit) {
      console.log("\n[dev] Resetting Tailscale serve...");
      disableTailscaleServe();
    }
    vite.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  vite.on("exit", (code) => {
    if (tailscaleMode === "serve" && resetOnExit) {
      disableTailscaleServe();
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
