import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

type UiBindMode = "loopback" | "lan" | "tailnet";

interface UiConfig {
  port?: number;
  bind?: UiBindMode;
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

/**
 * Scan network interfaces for tailnet IPv4 (100.64.0.0/10)
 */
function pickTailnetIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      // Tailnet uses 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
      const octets = addr.address.split(".").map(Number);
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}

/**
 * Fallback: get tailnet IP from tailscale status --json
 */
function getTailscaleIP(): string | null {
  try {
    const output = execSync("tailscale status --json", { encoding: "utf-8", timeout: 5000 });
    const status = JSON.parse(output);
    const ips = status?.Self?.TailscaleIPs as string[] | undefined;
    // Prefer IPv4
    return ips?.find((ip: string) => !ip.includes(":")) ?? ips?.[0] ?? null;
  } catch {
    return null;
  }
}

function resolveHost(bind?: UiBindMode): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  if (bind === "tailnet") {
    const ip = pickTailnetIPv4() ?? getTailscaleIP();
    if (ip) return ip;
    console.warn("[vite] tailnet bind: no tailnet IP found, falling back to 127.0.0.1");
    return "127.0.0.1";
  }
  return "127.0.0.1";
}

const uiConfig = loadUiConfig();
const port = uiConfig.port ?? 3000;
const host = resolveHost(uiConfig.bind);

export default defineConfig({
  plugins: [solid()],
  build: {
    rollupOptions: {
      input: "./index.html",
    },
  },
  server: {
    host,
    port,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:4000",
        ws: true,
      },
    },
  },
  preview: {
    host,
    port,
  },
});
