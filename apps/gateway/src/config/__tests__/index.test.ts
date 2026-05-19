import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearConfigCacheForTests, getConfigPath, loadConfig } from "../index.js";
import { writeFileSync } from "node:fs";

async function writeAgent(dir: string, id = path.basename(dir)) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "agent.yaml"),
    `id: ${id}\nname: ${id}\nmodel:\n  provider: anthropic\n  model: claude\n`
  );
}

describe("config loading", () => {
  const prevConfig = process.env.AIHUB_CONFIG;
  const prevHome = process.env.AIHUB_HOME;

  afterEach(() => {
    clearConfigCacheForTests();
    if (prevConfig === undefined) delete process.env.AIHUB_CONFIG;
    else process.env.AIHUB_CONFIG = prevConfig;
    if (prevHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevHome;
  });

  it("honors AIHUB_HOME and exact agent dirs", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-"));
    const agentDir = path.join(tmpDir, "agents", "custom");
    await writeAgent(agentDir);
    await fs.writeFile(
      path.join(tmpDir, "aihub.json"),
      JSON.stringify({ version: 3, agents: [agentDir] })
    );

    process.env.AIHUB_HOME = tmpDir;

    expect(getConfigPath()).toBe(path.join(tmpDir, "aihub.json"));
    const agents = loadConfig().agents;
    expect(agents.map((agent) => agent.id)).toEqual(["custom"]);
    expect(agents[0].workspace).toBe(agentDir);
    expect(agents[0].workspaceDir).toBe(agentDir);
  });

  it("loads agents from direct child glob", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-glob-"));
    await writeAgent(path.join(tmpDir, "agents", "beta"));
    await writeAgent(path.join(tmpDir, "agents", "alpha"));
    await fs.writeFile(
      path.join(tmpDir, "aihub.json"),
      JSON.stringify({ version: 3, agents: "./agents/*" })
    );
    process.env.AIHUB_HOME = tmpDir;

    expect(loadConfig().agents.map((agent) => agent.id)).toEqual(["alpha", "beta"]);
  });

  it("rejects v2 config with migrate message", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-v2-"));
    await fs.writeFile(path.join(tmpDir, "aihub.json"), JSON.stringify({ version: 2, agents: [] }));
    process.env.AIHUB_HOME = tmpDir;
    expect(() => loadConfig()).toThrow("aihub.json is version 2. Run `aihub agents migrate` to upgrade to version 3.");
  });

  it("rejects id mismatch", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-id-"));
    const agentDir = path.join(tmpDir, "agents", "folder");
    await writeAgent(agentDir, "other");
    await fs.writeFile(path.join(tmpDir, "aihub.json"), JSON.stringify({ version: 3, agents: [agentDir] }));
    process.env.AIHUB_HOME = tmpDir;
    expect(() => loadConfig()).toThrow(/id mismatch/);
  });

  it("warns at startup when onecli CA file path does not exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-onecli-ca-"));
    await fs.writeFile(
      path.join(tmpDir, "aihub.json"),
      JSON.stringify({
        version: 3,
        agents: [],
        onecli: { enabled: true, gatewayUrl: "http://localhost:10255", ca: { source: "file", path: "/nonexistent/onecli-ca.pem" } },
      })
    );
    process.env.AIHUB_HOME = tmpDir;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => loadConfig()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/CA file not found.*\/nonexistent\/onecli-ca\.pem/));
    warnSpy.mockRestore();
  });

  it("does not throw when onecli CA file path exists", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-onecli-ca-ok-"));
    const caPath = path.join(tmpDir, "ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
    await fs.writeFile(
      path.join(tmpDir, "aihub.json"),
      JSON.stringify({ version: 3, agents: [], onecli: { enabled: true, gatewayUrl: "http://localhost:10255", ca: { source: "file", path: caPath } } })
    );
    process.env.AIHUB_HOME = tmpDir;

    expect(() => loadConfig()).not.toThrow();
  });
});
