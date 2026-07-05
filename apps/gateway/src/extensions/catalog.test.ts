import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayConfigSchema, type AgentConfig } from "@aihub/shared";
import { buildExtensionCatalog } from "./catalog.js";
import { getBuiltInExtensionRegistrations } from "./registry.js";

const require = createRequire(import.meta.url);
const zodUrl = pathToFileURL(require.resolve("zod")).href;

/** Write a valid external extension dir with an index.js under `root/id`. */
async function writeExternalExtension(
  root: string,
  id: string,
  body: {
    routePrefixes?: string;
    configSchema?: string;
    configJsonSchema?: string;
    requiredSecrets?: string;
  } = {}
): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ type: "module" })
  );
  await writeFile(
    path.join(dir, "index.js"),
    [
      `import { z } from ${JSON.stringify(zodUrl)};`,
      "export default {",
      `  id: ${JSON.stringify(id)},`,
      `  displayName: ${JSON.stringify(`Ext ${id}`)},`,
      `  description: ${JSON.stringify(`Extension ${id}`)},`,
      "  dependencies: [],",
      `  configSchema: ${body.configSchema ?? "z.object({})"},`,
      body.configJsonSchema
        ? `  configJsonSchema: ${body.configJsonSchema},`
        : "",
      body.requiredSecrets
        ? `  requiredSecrets: ${body.requiredSecrets},`
        : "",
      `  routePrefixes: ${body.routePrefixes ?? "[]"},`,
      "  validateConfig: () => ({ valid: true, errors: [] }),",
      "  registerRoutes: () => undefined,",
      "  start: async () => undefined,",
      "  stop: async () => undefined,",
      "  capabilities: () => [],",
      "};",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function makeAgent(
  extensions?: Record<string, Record<string, unknown>>
): AgentConfig {
  return GatewayConfigSchema.parse({
    version: 2,
    agents: [
      {
        id: "main",
        name: "Main",
        workspace: "~/agents/main",
        model: { provider: "anthropic", model: "claude" },
        ...(extensions ? { extensions } : {}),
      },
    ],
    extensions: {},
  }).agents[0];
}

function configWith(agent: AgentConfig, extensionsPath: string) {
  return GatewayConfigSchema.parse({
    version: 2,
    agents: [agent],
    extensions: {},
    extensionsPath,
  });
}

describe("buildExtensionCatalog", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "aihub-catalog-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists the full built-in registry with no ghosts and no missing ids", async () => {
    const agent = makeAgent();
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);

    const builtInIds = catalog
      .filter((entry) => entry.builtIn)
      .map((entry) => entry.id)
      .sort();

    // Every built-in that loads in this deployment must appear exactly once.
    const registrations = getBuiltInExtensionRegistrations();
    const loadable: string[] = [];
    for (const registration of registrations) {
      try {
        const ext = await registration.load();
        loadable.push(ext.id);
      } catch {
        // package not installed here — must NOT be in the catalog
      }
    }
    expect(builtInIds).toEqual([...loadable].sort());

    // No duplicate ids across the whole catalog.
    const allIds = catalog.map((entry) => entry.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("includes runtime-scanned external extensions alongside built-ins", async () => {
    await writeExternalExtension(root, "acme-tool");
    const agent = makeAgent();
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);

    const acme = catalog.find((entry) => entry.id === "acme-tool");
    expect(acme).toBeDefined();
    expect(acme?.builtIn).toBe(false);
    // built-ins still present
    expect(catalog.some((entry) => entry.builtIn)).toBe(true);
  });

  it("reports per-agent enabled state correctly", async () => {
    await writeExternalExtension(root, "on-ext");
    await writeExternalExtension(root, "off-ext");
    await writeExternalExtension(root, "absent-ext");

    const agent = makeAgent({
      "on-ext": { enabled: true },
      "off-ext": { enabled: false },
      // absent-ext: not referenced by the agent at all
    });
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);

    const byId = Object.fromEntries(catalog.map((e) => [e.id, e]));
    expect(byId["on-ext"].enabled).toBe(true);
    expect(byId["off-ext"].enabled).toBe(false);
    // Not referenced by the agent → disabled for this agent, but still listed.
    expect(byId["absent-ext"].enabled).toBe(false);
  });

  it("treats a present-but-empty agent config as enabled (enabled defaults true)", async () => {
    await writeExternalExtension(root, "bare-ext");
    const agent = makeAgent({ "bare-ext": {} });
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);
    const bare = catalog.find((e) => e.id === "bare-ext");
    expect(bare?.enabled).toBe(true);
  });

  it("assigns tiers: bespoke-route > auto-form > toggle-only", async () => {
    // Route-having external → bespoke-route, even with a schema.
    await writeExternalExtension(root, "routed", {
      routePrefixes: '["/api/routed"]',
      configJsonSchema:
        '{ type: "object", properties: { apiKey: { type: "string" } } }',
    });
    // Schema-having, no route → auto-form.
    await writeExternalExtension(root, "formy", {
      configJsonSchema:
        '{ type: "object", properties: { apiKey: { type: "string" } } }',
    });
    // No route, only an enabled toggle in schema → toggle-only.
    await writeExternalExtension(root, "toggly", {
      configJsonSchema:
        '{ type: "object", properties: { enabled: { type: "boolean" } } }',
    });
    // No route, no config schema → toggle-only.
    await writeExternalExtension(root, "plain");

    const agent = makeAgent();
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);
    const byId = Object.fromEntries(catalog.map((e) => [e.id, e]));

    expect(byId["routed"].tier).toBe("bespoke-route");
    expect(byId["formy"].tier).toBe("auto-form");
    expect(byId["toggly"].tier).toBe("toggle-only");
    expect(byId["plain"].tier).toBe("toggle-only");
  });

  it("surfaces configJsonSchema and requiredSecrets when the extension exposes them", async () => {
    await writeExternalExtension(root, "secretful", {
      configJsonSchema:
        '{ type: "object", properties: { token: { type: "string" } } }',
      requiredSecrets: '["token"]',
    });
    const agent = makeAgent();
    const catalog = await buildExtensionCatalog(configWith(agent, root), agent);
    const entry = catalog.find((e) => e.id === "secretful");

    expect(entry?.requiredSecrets).toEqual(["token"]);
    expect(entry?.configJsonSchema).toMatchObject({
      properties: { token: { type: "string" } },
    });
    expect(entry?.tier).toBe("auto-form");
  });

  it("produces no external entries when the scan dir does not exist (no ghosts)", async () => {
    const missing = path.join(root, "does-not-exist");
    const agent = makeAgent();
    const catalog = await buildExtensionCatalog(
      configWith(agent, missing),
      agent
    );
    expect(catalog.every((entry) => entry.builtIn)).toBe(true);
  });
});
