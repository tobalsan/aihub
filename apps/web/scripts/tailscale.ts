import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Get tailnet hostname (DNS name or IP fallback) from tailscale status
 */
export function getTailnetHostname(): string {
  const candidates = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];

  for (const candidate of candidates) {
    if (candidate.startsWith("/") && !existsSync(candidate)) continue;
    try {
      const stdout = execSync(`${candidate} status --json`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      const parsed = JSON.parse(stdout);
      const self = parsed?.Self;
      const dns = typeof self?.DNSName === "string" ? self.DNSName : undefined;
      const ips = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];

      if (dns && dns.length > 0) return dns.replace(/\.$/, "");
      if (ips.length > 0) return ips[0];
    } catch {
      // Try next candidate
    }
  }

  throw new Error("Could not determine Tailscale DNS or IP");
}

/**
 * Enable tailscale serve on a port (HTTPS proxy)
 */
export function enableTailscaleServe(port: number): void {
  execSync(`tailscale serve --bg --yes ${port}`, {
    encoding: "utf-8",
    timeout: 15000,
  });
}

/**
 * Disable tailscale serve
 */
export function disableTailscaleServe(): void {
  try {
    execSync("tailscale serve reset", {
      encoding: "utf-8",
      timeout: 15000,
    });
  } catch {
    // Ignore errors on reset
  }
}
