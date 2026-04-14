import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentConfigSchema,
  GlobalSandboxConfigSchema,
  type MountAllowlist,
} from "@aihub/shared";
import {
  buildContainerArgs,
  buildVolumeMounts,
  validateMount,
  type ContainerVolumeMount,
} from "./container.js";

const tempDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-container-"));
  tempDirs.push(dir);
  return dir;
}

function argValues(args: string[], flag: string): string[] {
  return args
    .map((arg, index) => (arg === flag ? args[index + 1] : undefined))
    .filter((arg): arg is string => Boolean(arg));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildVolumeMounts", () => {
  it("builds standard, user, onecli, env shadow, and custom mounts", () => {
    const root = tmpDir();
    const workspace = path.join(root, "agents", "cloud");
    const shared = path.join(root, "shared");
    const aihubHome = path.join(root, "aihub");
    const custom = path.join(root, "docs");
    const caPath = path.join(root, "onecli-ca.pem");

    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(custom, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".env"), "SECRET=1");
    fs.writeFileSync(caPath, "cert");

    const agent = AgentConfigSchema.parse({
      id: "cloud",
      name: "Cloud",
      workspace,
      model: { provider: "anthropic", model: "claude" },
      sandbox: {
        mounts: [{ host: custom, container: "/docs", readonly: false }],
      },
    });
    const globalSandbox = GlobalSandboxConfigSchema.parse({
      sharedDir: shared,
      onecli: { url: "http://onecli:4141", caPath },
      mountAllowlist: { allowedRoots: [root] },
    });

    const mounts = buildVolumeMounts(agent, globalSandbox, aihubHome, "user-1");

    expect(mounts).toEqual(
      expect.arrayContaining<ContainerVolumeMount>([
        { source: workspace, target: "/workspace", readonly: true },
        { source: shared, target: "/shared", readonly: false },
        {
          source: path.join(aihubHome, "users", "user-1"),
          target: "/users/user-1",
          readonly: false,
        },
        {
          source: path.join(aihubHome, "sessions", "cloud"),
          target: "/sessions",
          readonly: false,
        },
        {
          source: path.join(aihubHome, "ipc", "cloud"),
          target: "/workspace/ipc",
          readonly: false,
        },
        {
          source: caPath,
          target: "/usr/local/share/ca-certificates/onecli-ca.pem",
          readonly: true,
        },
        { source: "/dev/null", target: "/workspace/.env", readonly: true },
        { source: custom, target: "/docs", readonly: false },
      ])
    );
  });

  it("uses a writable workspace mount when configured", () => {
    const root = tmpDir();
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    const agent = AgentConfigSchema.parse({
      id: "agent",
      name: "Agent",
      workspace,
      model: { provider: "anthropic", model: "claude" },
      sandbox: { workspaceWritable: true },
    });
    const mounts = buildVolumeMounts(agent, {}, path.join(root, "aihub"));

    expect(mounts[0]).toEqual({
      source: workspace,
      target: "/workspace",
      readonly: false,
    });
  });
});

describe("buildContainerArgs", () => {
  it("builds docker run args with mounts, resources, network, and env", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const agent = AgentConfigSchema.parse({
      id: "cloud",
      name: "Cloud",
      workspace: "/workspace",
      model: { provider: "anthropic", model: "claude" },
      sandbox: {
        image: "custom-agent:latest",
        network: "custom-net",
        memory: "4g",
        cpus: 2,
        env: { CUSTOM_VAR: "value" },
      },
    });
    const globalSandbox = GlobalSandboxConfigSchema.parse({
      network: { name: "aihub-agents" },
      onecli: { url: "http://onecli:4141" },
    });
    const mounts: ContainerVolumeMount[] = [
      { source: "/host/workspace", target: "/workspace", readonly: true },
      { source: "/host/shared", target: "/shared", readonly: false },
    ];

    const args = buildContainerArgs(
      agent,
      globalSandbox,
      mounts,
      "/aihub",
      "user-1"
    );

    expect(args.slice(0, 3)).toEqual(["run", "-i", "--rm"]);
    expect(argValues(args, "--name")).toEqual(["aihub-agent-cloud-123456"]);
    expect(argValues(args, "--memory")).toEqual(["4g"]);
    expect(argValues(args, "--cpus")).toEqual(["2"]);
    expect(argValues(args, "--network")).toEqual(["custom-net"]);
    expect(argValues(args, "--mount")).toEqual([
      "type=bind,source=/host/workspace,target=/workspace,readonly",
      "type=bind,source=/host/shared,target=/shared",
    ]);
    expect(argValues(args, "--env")).toEqual(
      expect.arrayContaining([
        "NODE_TLS_REJECT_UNAUTHORIZED=0",
        "GATEWAY_URL=http://gateway:4000",
        "ONECLI_URL=http://onecli:4141",
        "ONECLI_CA_PATH=/usr/local/share/ca-certificates/onecli-ca.pem",
        "ANTHROPIC_BASE_URL=http://onecli:4141",
        "OPENAI_BASE_URL=http://onecli:4141/v1",
        "CUSTOM_VAR=value",
      ])
    );
    expect(args.at(-1)).toBe("custom-agent:latest");
  });

  it("omits onecli env when global sandbox onecli is absent", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const agent = AgentConfigSchema.parse({
      id: "cloud",
      name: "Cloud",
      workspace: "/workspace",
      model: { provider: "anthropic", model: "claude" },
      sandbox: {},
    });

    const args = buildContainerArgs(agent, {}, [], "/aihub");

    expect(argValues(args, "--env")).toEqual([
      "GATEWAY_URL=http://gateway:4000",
    ]);
  });
});

describe("validateMount", () => {
  const allowlist: MountAllowlist = {
    allowedRoots: [path.join(os.tmpdir(), "allowed-root")],
    blockedPatterns: [".ssh", ".aws", ".env"],
  };

  it("accepts allowed absolute mount paths", () => {
    expect(() =>
      validateMount(
        {
          host: path.join(allowlist.allowedRoots[0], "docs"),
          container: "/docs",
          readonly: true,
        },
        allowlist
      )
    ).not.toThrow();
  });

  it("rejects host paths outside the allowlist", () => {
    expect(() =>
      validateMount(
        { host: "/etc/passwd", container: "/passwd", readonly: true },
        allowlist
      )
    ).toThrow(/not allowed/);
  });

  it("rejects symlinks that escape the allowlist", () => {
    const root = tmpDir();
    const allowedRoot = path.join(root, "allowed");
    const outsideRoot = path.join(root, "outside");
    const outsidePath = path.join(outsideRoot, "secret");
    const symlinkPath = path.join(allowedRoot, "link");

    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.mkdirSync(outsidePath, { recursive: true });
    fs.symlinkSync(outsidePath, symlinkPath);

    expect(() =>
      validateMount(
        { host: symlinkPath, container: "/docs", readonly: true },
        { ...allowlist, allowedRoots: [allowedRoot] }
      )
    ).toThrow(/not allowed/);
  });

  it.each([".ssh", ".aws", ".env"])(
    "rejects blocked host path pattern %s",
    (pattern) => {
      expect(() =>
        validateMount(
          {
            host: path.join(allowlist.allowedRoots[0], pattern, "data"),
            container: "/data",
            readonly: true,
          },
          allowlist
        )
      ).toThrow(/blocked pattern/);
    }
  );

  it("rejects path traversal in container paths", () => {
    expect(() =>
      validateMount(
        {
          host: path.join(allowlist.allowedRoots[0], "docs"),
          container: "/docs/../secrets",
          readonly: true,
        },
        allowlist
      )
    ).toThrow(/path traversal/);
  });

  it("rejects non-absolute container paths", () => {
    expect(() =>
      validateMount(
        {
          host: path.join(allowlist.allowedRoots[0], "docs"),
          container: "docs",
          readonly: true,
        },
        allowlist
      )
    ).toThrow(/absolute/);
  });
});
