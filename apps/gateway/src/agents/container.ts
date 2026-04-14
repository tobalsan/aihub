import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentConfig,
  GlobalSandboxConfig,
  MountAllowlist,
  SandboxMount,
} from "@aihub/shared";

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

function resolveHostPath(hostPath: string): string {
  if (hostPath === "~") return os.homedir();
  if (hostPath.startsWith("~/")) {
    return path.join(os.homedir(), hostPath.slice(2));
  }
  return path.resolve(hostPath);
}

function isUnderRoot(hostPath: string, root: string): boolean {
  const relative = path.relative(resolveHostPath(root), hostPath);
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
  const hostPath = resolveHostPath(mount.host);

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
  userId?: string
): ContainerVolumeMount[] {
  const mounts: ContainerVolumeMount[] = [];
  const sandbox = agent.sandbox;
  const workspace = resolveHostPath(agent.workspace);
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

  if (globalSandbox.onecli?.caPath) {
    const caPath = resolveHostPath(globalSandbox.onecli.caPath);
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

export function buildContainerArgs(
  agent: AgentConfig,
  globalSandbox: GlobalSandboxConfig,
  mounts: ContainerVolumeMount[],
  _aihubHome: string,
  _userId?: string
): string[] {
  const sandbox = agent.sandbox;
  const onecliUrl = globalSandbox.onecli?.url;
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
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    GATEWAY_URL: DEFAULT_GATEWAY_URL,
    ...(onecliUrl
      ? {
          ONECLI_URL: onecliUrl,
          ONECLI_CA_PATH: CONTAINER_ONECLI_CA_PATH,
          ANTHROPIC_BASE_URL: onecliUrl,
          OPENAI_BASE_URL: `${onecliUrl.replace(/\/$/, "")}/v1`,
        }
      : {}),
    ...(sandbox?.env ?? {}),
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
