import os from "node:os";
import { execSync } from "node:child_process";

export type BindHostMode = "loopback" | "lan" | "tailnet";

export function pickTailnetIPv4(): string | null {
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

export function getTailscaleIP(): string | null {
  try {
    const output = execSync("tailscale status --json", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const status = JSON.parse(output) as {
      Self?: { TailscaleIPs?: string[] };
    };
    const ips = status.Self?.TailscaleIPs;
    return ips?.find((ip) => !ip.includes(":")) ?? ips?.[0] ?? null;
  } catch {
    return null;
  }
}

export function resolveBindHost(bind?: BindHostMode): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  return pickTailnetIPv4() ?? getTailscaleIP() ?? "127.0.0.1";
}
