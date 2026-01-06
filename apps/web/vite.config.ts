import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

type BindMode = "loopback" | "lan" | "tailnet";

interface TailscaleConfig {
  mode?: "off" | "serve";
  resetOnExit?: boolean;
}

interface UiConfig {
  port?: number;
  bind?: BindMode;
  tailscale?: TailscaleConfig;
}

interface GatewayConfig {
  host?: string;
  port?: number;
  bind?: BindMode;
}

interface AihubConfig {
  ui?: UiConfig;
  gateway?: GatewayConfig;
}

function loadConfig(): AihubConfig {
  try {
    const configPath = path.join(os.homedir(), ".aihub", "aihub.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
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

/**
 * Get tailnet MagicDNS hostname
 */
function getTailnetHostname(): string | null {
  try {
    const output = execSync("tailscale status --json", { encoding: "utf-8", timeout: 5000 });
    const status = JSON.parse(output);
    const dns = status?.Self?.DNSName as string | undefined;
    return dns ? dns.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

function resolveHost(bind?: BindMode): string {
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

const config = loadConfig();
const uiConfig = config.ui ?? {};
const gatewayConfig = config.gateway ?? {};

const port = uiConfig.port ?? 3000;
const tailscaleServe = uiConfig.tailscale?.mode === "serve";

// When using tailscale serve, bind to localhost so tailscale can proxy to it
// Otherwise, use the configured bind mode
const host = tailscaleServe ? "127.0.0.1" : resolveHost(uiConfig.bind);

// Get MagicDNS hostname for allowed hosts when using tailscale serve
const tailnetHostname = tailscaleServe ? getTailnetHostname() : null;
const hmrHostOverride = process.env.AIHUB_HMR_HOST;

// Resolve gateway target for proxy
const gatewayHost = gatewayConfig.host ?? resolveHost(gatewayConfig.bind);
const gatewayPort = gatewayConfig.port ?? 4000;
const gatewayTarget = `http://${gatewayHost}:${gatewayPort}`;

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
    // Allow MagicDNS hostname when using tailscale serve
    allowedHosts: tailnetHostname ? [tailnetHostname] : undefined,
    // Let HMR follow the browser host by default; allow override if needed
    hmr: hmrHostOverride ? { host: hmrHostOverride } : undefined,
    proxy: {
      "/api": {
        target: gatewayTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: gatewayTarget,
        ws: true,
      },
    },
  },
  preview: {
    host,
    port,
  },
});
