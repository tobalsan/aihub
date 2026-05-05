import type { Command } from "commander";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, loadConfig } from "../config/index.js";

const LABEL = "com.aihub.gateway";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assertDarwin(): void {
  if (process.platform !== "darwin") {
    console.error(
      "aihub gateway service: macOS launchd only — Linux/systemd support pending."
    );
    process.exit(1);
  }
}

function getPlistPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LABEL}.plist`
  );
}

function getServiceTarget(): string {
  return `gui/${process.getuid?.() ?? ""}/${LABEL}`;
}

function getDomainTarget(): string {
  return `gui/${process.getuid?.() ?? ""}`;
}

function resolveCliEntry(): string {
  // service.ts lives in dist/cli/ at runtime → sibling index.js is the bin entry
  const candidate = path.join(__dirname, "index.js");
  if (fs.existsSync(candidate)) return candidate;
  // Fallback to globally-linked aihub
  try {
    const out = execSync("command -v aihub", { encoding: "utf-8" }).trim();
    if (out) return out;
  } catch {
    // ignore
  }
  throw new Error(
    `Cannot resolve aihub CLI entry; expected ${candidate} or 'aihub' on PATH.`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPlist(): string {
  const node = process.execPath;
  const entry = resolveCliEntry();
  const logsDir = path.join(CONFIG_DIR, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const stdout = path.join(logsDir, "gateway.out.log");
  const stderr = path.join(logsDir, "gateway.err.log");
  const homePath = process.env.HOME ?? os.homedir();
  const pathEnv =
    process.env.PATH ??
    "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  const args = [node, entry, "gateway"];
  const argXml = args
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(CONFIG_DIR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AIHUB_HOME</key>
    <string>${escapeXml(CONFIG_DIR)}</string>
    <key>HOME</key>
    <string>${escapeXml(homePath)}</string>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderr)}</string>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

function runLaunchctl(args: string[], allowFail = false): number {
  try {
    execFileSync("launchctl", args, { stdio: "inherit" });
    return 0;
  } catch (err) {
    if (allowFail) {
      const status =
        (err as { status?: number }).status ??
        (typeof (err as { code?: number }).code === "number"
          ? ((err as { code: number }).code as number)
          : 1);
      return status;
    }
    throw err;
  }
}

function isLoaded(): boolean {
  try {
    execFileSync("launchctl", ["print", getServiceTarget()], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function installService(): void {
  assertDarwin();
  const plistPath = getPlistPath();
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const plist = buildPlist();
  fs.writeFileSync(plistPath, plist, { mode: 0o644 });

  // Bootout existing instance if present (idempotent install)
  if (isLoaded()) {
    runLaunchctl(["bootout", getServiceTarget()], true);
  }
  runLaunchctl(["bootstrap", getDomainTarget(), plistPath]);

  const logsDir = path.join(CONFIG_DIR, "logs");
  console.log(`Installed: ${plistPath}`);
  console.log(`Logs:      ${logsDir}/gateway.{out,err}.log`);
  console.log(`Service:   ${LABEL} (loaded, RunAtLoad=true)`);
}

function startService(): void {
  assertDarwin();
  const plistPath = getPlistPath();
  if (!fs.existsSync(plistPath)) {
    console.error(
      `Service not installed. Run 'aihub gateway install' first.`
    );
    process.exit(1);
  }
  if (!isLoaded()) {
    runLaunchctl(["bootstrap", getDomainTarget(), plistPath]);
  }
  runLaunchctl(["kickstart", "-k", getServiceTarget()]);
  console.log(`Started: ${LABEL}`);
}

function stopService(): void {
  assertDarwin();
  if (!isLoaded()) {
    console.log(`Not running: ${LABEL}`);
    return;
  }
  runLaunchctl(["bootout", getServiceTarget()]);
  console.log(`Stopped: ${LABEL}`);
}

type LaunchctlInfo = {
  loaded: boolean;
  pid: number | null;
  state: string | null;
  lastExitCode: number | null;
};

function readLaunchctlInfo(): LaunchctlInfo {
  let raw: string;
  try {
    raw = execFileSync("launchctl", ["print", getServiceTarget()], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return { loaded: false, pid: null, state: null, lastExitCode: null };
  }
  const pidMatch = raw.match(/^\s*pid\s*=\s*(\d+)/m);
  const stateMatch = raw.match(/^\s*state\s*=\s*(\S+)/m);
  const exitMatch = raw.match(/^\s*last exit code\s*=\s*(-?\d+)/m);
  return {
    loaded: true,
    pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
    state: stateMatch ? stateMatch[1] : null,
    lastExitCode: exitMatch ? parseInt(exitMatch[1], 10) : null,
  };
}

function readPorts(): { gateway: number; ui: number; uiEnabled: boolean } {
  try {
    const cfg = loadConfig();
    return {
      gateway: cfg.gateway?.port ?? 4000,
      ui: cfg.ui?.port ?? 3000,
      uiEnabled: cfg.ui?.enabled !== false,
    };
  } catch {
    return { gateway: 4000, ui: 3000, uiEnabled: true };
  }
}

function homeTilde(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function statusService(): void {
  assertDarwin();
  const info = readLaunchctlInfo();
  const { gateway, ui, uiEnabled } = readPorts();
  const plistPath = getPlistPath();
  const plistExists = fs.existsSync(plistPath);
  const logsDir = path.join(CONFIG_DIR, "logs");

  let statusLine: string;
  if (!plistExists && !info.loaded) {
    statusLine = "not installed";
  } else if (info.loaded && info.pid && info.pid > 0) {
    const stateSuffix =
      info.state && info.state !== "running" ? ` (${info.state})` : "";
    statusLine = `running pid ${info.pid}${stateSuffix}`;
  } else if (info.loaded) {
    const exitSuffix =
      info.lastExitCode !== null ? ` last_exit=${info.lastExitCode}` : "";
    statusLine = `loaded, not running${exitSuffix}`;
  } else {
    statusLine = "installed, not loaded";
  }

  const rows: Array<[string, string]> = [
    ["Service", LABEL],
    ["Status", statusLine],
    ["Gateway", `http://127.0.0.1:${gateway}`],
    ["UI", uiEnabled ? `http://127.0.0.1:${ui}` : "disabled"],
    ["Plist", homeTilde(plistPath)],
    ["Logs", `${homeTilde(logsDir)}/gateway.{out,err}.log`],
  ];

  const labelWidth = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `  ${k.padEnd(labelWidth)}  ${v}`);
  const inner = Math.max(...lines.map((l) => l.length));
  const bar = "─".repeat(inner + 2);

  console.log(`┌${bar}┐`);
  console.log(`│ ${"AIHub Gateway Service".padEnd(inner)} │`);
  console.log(`├${bar}┤`);
  for (const line of lines) {
    console.log(`│${line.padEnd(inner + 2)}│`);
  }
  console.log(`└${bar}┘`);
}

function uninstallService(): void {
  assertDarwin();
  if (isLoaded()) {
    runLaunchctl(["bootout", getServiceTarget()], true);
  }
  const plistPath = getPlistPath();
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
    console.log(`Removed: ${plistPath}`);
  } else {
    console.log(`No plist at ${plistPath}`);
  }
  console.log(`Uninstalled: ${LABEL}`);
}

export function registerGatewayServiceCommands(gatewayCmd: Command): void {
  gatewayCmd
    .command("install")
    .description("Install the gateway as a launchd service (macOS)")
    .action(() => {
      try {
        installService();
      } catch (err) {
        console.error(
          "install failed:",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    });

  gatewayCmd
    .command("start")
    .description("Start the installed gateway service")
    .action(() => {
      try {
        startService();
      } catch (err) {
        console.error(
          "start failed:",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    });

  gatewayCmd
    .command("stop")
    .description("Stop the installed gateway service")
    .action(() => {
      try {
        stopService();
      } catch (err) {
        console.error(
          "stop failed:",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    });

  gatewayCmd
    .command("status")
    .description("Show gateway service status")
    .action(() => {
      try {
        statusService();
      } catch (err) {
        console.error(
          "status failed:",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    });

  gatewayCmd
    .command("uninstall")
    .description("Remove the gateway launchd service")
    .action(() => {
      try {
        uninstallService();
      } catch (err) {
        console.error(
          "uninstall failed:",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    });
}
