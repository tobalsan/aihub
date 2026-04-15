import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentConfig,
  GlobalSandboxConfig,
  MountAllowlist,
  OnecliConfig,
  SandboxMount,
} from "@aihub/shared";
import { resolveWorkspaceDir } from "../config/index.js";

export type ContainerVolumeMount = {
  source: string;
  target: string;
  readonly: boolean;
};

const DEFAULT_IMAGE = "aihub-agent:latest";
const DEFAULT_MEMORY = "2g";
const DEFAULT_CPUS = 1;
const DEFAULT_NETWORK = "aihub-agents";
const DEFAULT_GATEWAY_URL = "http://gateway:4000";
const CONTAINER_ONECLI_CA_PATH =
  "/usr/local/share/ca-certificates/onecli-ca.pem";

export function getMountedOnecliCaPath(
  onecli?: OnecliConfig
): string | undefined {
  if (onecli?.ca?.source !== "file" || !onecli.ca.path) return undefined;
  if (!fs.existsSync(resolveHostPath(onecli.ca.path))) return undefined;
  return CONTAINER_ONECLI_CA_PATH;
}
const SECRET_KEY_PATTERNS = [
  "KEY",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "AUTH",
  "PRIVATE",
  "API_KEY",
  "ACCESS_KEY",
  "SECRET_KEY",
];
const SECRET_VALUE_PREFIXES = [
  "sk-",
  "pk-",
  "ghp_",
  "gho_",
  "ghu_",
  "github_pat_",
  "xoxb-",
  "xoxp-",
  "xapp-",
];

function resolveHostPath(hostPath: string): string {
  if (hostPath === "~") return os.homedir();
  if (hostPath.startsWith("~/")) {
    return path.join(os.homedir(), hostPath.slice(2));
  }
  return path.resolve(hostPath);
}

function isUnderRoot(hostPath: string, root: string): boolean {
  let rootPath = resolveHostPath(root);
  try {
    rootPath = fs.realpathSync(rootPath);
  } catch {
    // Nonexistent roots are validated lexically.
  }
  const relative = path.relative(rootPath, hostPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function blockedHostSegment(
  hostPath: string,
  patterns: string[]
): string | null {
  const segments = resolveHostPath(hostPath).split(path.sep).filter(Boolean);
  return (
    patterns.find((pattern) =>
      segments.some((segment) => segment.includes(pattern))
    ) ?? null
  );
}

function addMount(
  mounts: ContainerVolumeMount[],
  source: string,
  target: string,
  readonly: boolean
): void {
  mounts.push({ source, target, readonly });
}

export function validateMount(
  mount: SandboxMount,
  allowlist: MountAllowlist
): void {
  let hostPath = resolveHostPath(mount.host);

  try {
    hostPath = fs.realpathSync(hostPath);
  } catch {
    // Nonexistent paths can still be created later.
  }

  if (!allowlist.allowedRoots.some((root) => isUnderRoot(hostPath, root))) {
    throw new Error(
      `Mount host path is not allowed by sandbox allowlist: ${mount.host}`
    );
  }

  const blockedPattern = blockedHostSegment(
    hostPath,
    allowlist.blockedPatterns ?? []
  );
  if (blockedPattern) {
    throw new Error(
      `Mount host path contains blocked pattern "${blockedPattern}": ${mount.host}`
    );
  }

  if (!mount.container.startsWith("/")) {
    throw new Error(
      `Mount container path must be absolute: ${mount.container}`
    );
  }

  if (mount.container.split("/").includes("..")) {
    throw new Error(
      `Mount container path cannot contain path traversal: ${mount.container}`
    );
  }
}

export function buildVolumeMounts(
  agent: AgentConfig,
  globalSandbox: GlobalSandboxConfig,
  aihubHome: string,
  userId?: string,
  onecli?: OnecliConfig
): ContainerVolumeMount[] {
  const mounts: ContainerVolumeMount[] = [];
  const sandbox = agent.sandbox;
  const workspace = resolveWorkspaceDir(agent.workspace);
  const home = resolveHostPath(aihubHome);

  addMount(mounts, workspace, "/workspace", !sandbox?.workspaceWritable);

  if (globalSandbox.sharedDir) {
    addMount(
      mounts,
      resolveHostPath(globalSandbox.sharedDir),
      "/shared",
      false
    );
  }

  if (userId) {
    addMount(
      mounts,
      path.join(home, "users", userId),
      `/users/${userId}`,
      false
    );
  }

  addMount(mounts, path.join(home, "sessions", agent.id), "/sessions", false);
  addMount(mounts, path.join(home, "ipc", agent.id), "/workspace/ipc", false);

  if (onecli?.ca?.source === "file" && onecli.ca.path) {
    const caPath = resolveHostPath(onecli.ca.path);
    if (fs.existsSync(caPath)) {
      addMount(mounts, caPath, CONTAINER_ONECLI_CA_PATH, true);
    }
  }

  const workspaceEnvPath = path.join(workspace, ".env");
  if (fs.existsSync(workspaceEnvPath)) {
    addMount(mounts, "/dev/null", "/workspace/.env", true);
  }

  if (sandbox?.mounts?.length) {
    if (!globalSandbox.mountAllowlist) {
      throw new Error("Custom sandbox mounts require a mount allowlist");
    }

    for (const mount of sandbox.mounts) {
      validateMount(mount, globalSandbox.mountAllowlist);
      addMount(
        mounts,
        resolveHostPath(mount.host),
        mount.container,
        mount.readonly ?? true
      );
    }
  }

  return mounts;
}

export function filterSecretEnvVars(
  env: Record<string, string> | undefined,
  warn: (message: string) => void = console.warn
): Record<string, string> {
  if (!env) return {};

  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const upperKey = key.toUpperCase();
    const lowerValue = value.toLowerCase();
    const keyLooksSecret = SECRET_KEY_PATTERNS.some((pattern) =>
      upperKey.includes(pattern)
    );
    const valueLooksBase64Secret =
      value.length > 20 && /^[A-Za-z0-9+/=]+$/.test(value);
    const valueLooksPrefixedSecret = SECRET_VALUE_PREFIXES.some((prefix) =>
      lowerValue.startsWith(prefix)
    );

    if (keyLooksSecret || valueLooksBase64Secret || valueLooksPrefixedSecret) {
      warn(`Filtered sandbox.env key "${key}" (looks like secret)`);
      continue;
    }

    filtered[key] = value;
  }

  return filtered;
}

export function buildContainerArgs(
  agent: AgentConfig,
  globalSandbox: GlobalSandboxConfig,
  mounts: ContainerVolumeMount[],
  _aihubHome: string,
  _userId?: string,
  onecli?: OnecliConfig
): string[] {
  const sandbox = agent.sandbox;
  const onecliEnabled = onecli?.enabled !== false;
  const args = [
    "run",
    "-i",
    "--rm",
    "--name",
    `aihub-agent-${agent.id}-${Date.now()}`,
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--memory",
    sandbox?.memory ?? DEFAULT_MEMORY,
    "--cpus",
    String(sandbox?.cpus ?? DEFAULT_CPUS),
    "--network",
    sandbox?.network ?? globalSandbox.network?.name ?? DEFAULT_NETWORK,
  ];

  for (const mount of mounts) {
    args.push(
      "--mount",
      `type=bind,source=${mount.source},target=${mount.target}${
        mount.readonly ? ",readonly" : ""
      }`
    );
  }

  const env: Record<string, string> = {
    GATEWAY_URL: DEFAULT_GATEWAY_URL,
    ...(onecliEnabled && onecli?.gatewayUrl
      ? {
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          ONECLI_URL: onecli.gatewayUrl,
          ONECLI_CA_PATH: CONTAINER_ONECLI_CA_PATH,
          ANTHROPIC_BASE_URL: onecli.gatewayUrl,
          OPENAI_BASE_URL: `${onecli.gatewayUrl.replace(/\/$/, "")}/v1`,
        }
      : {}),
    ...filterSecretEnvVars(sandbox?.env),
  };

  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(sandbox?.image ?? DEFAULT_IMAGE);

  return args;
}

export function ensureNetwork(networkName: string, internal: boolean): void {
  try {
    execFileSync("docker", ["network", "inspect", networkName], {
      stdio: "ignore",
    });
  } catch {
    execFileSync(
      "docker",
      ["network", "create", ...(internal ? ["--internal"] : []), networkName],
      { stdio: "ignore" }
    );
  }
}

function findRepoRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "container/agent-runner/Dockerfile"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function ensureAgentImage(image: string): void {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
    return;
  } catch {
    // not present — build below
  }
  if (image !== DEFAULT_IMAGE) {
    throw new Error(
      `Sandbox image ${image} not present locally; build it before starting the gateway.`
    );
  }
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    throw new Error(
      `Cannot locate container/agent-runner/Dockerfile to build ${image}`
    );
  }
  console.log(`Container sandbox: building ${image} (first run)...`);
  execFileSync(
    "docker",
    [
      "build",
      "-t",
      image,
      "-f",
      "container/agent-runner/Dockerfile",
      repoRoot,
    ],
    { stdio: "inherit" }
  );
}

export function cleanupOrphanContainers(): void {
  const containerIds = execFileSync(
    "docker",
    ["ps", "-q", "--filter", "name=aihub-agent-"],
    { encoding: "utf8" }
  )
    .split("\n")
    .map((id) => id.trim())
    .filter(Boolean);

  if (containerIds.length) {
    execFileSync("docker", ["rm", "-f", ...containerIds], { stdio: "ignore" });
  }
}
