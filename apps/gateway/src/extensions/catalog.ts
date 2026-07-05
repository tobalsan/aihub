import type { AgentConfig, Extension, GatewayConfig } from "@aihub/shared";
import { discoverExternalExtensions } from "@aihub/shared";
import {
  getBuiltInExtensionRegistrations,
  getExternalExtensionsPath,
} from "./registry.js";

/**
 * Where an extension's config surface lives, so the hub UI knows how to render
 * it:
 *  - `auto-form`: the extension exposes a config JSON-schema we can render as a
 *    form.
 *  - `bespoke-route`: the extension self-registers its own admin route(s); the
 *    hub links out instead of rendering a form.
 *  - `toggle-only`: no config beyond enabled/disabled.
 *
 * Bespoke routes win over auto-form: an extension that ships its own route owns
 * its config surface even if it also happens to expose a schema.
 */
export type ExtensionConfigTier =
  | "auto-form"
  | "bespoke-route"
  | "toggle-only";

export type ExtensionCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  /** true = built-in static registry, false = runtime-scanned external dir. */
  builtIn: boolean;
  /** Enabled for this specific agent (agent-scoped config). */
  enabled: boolean;
  /** Config JSON-schema when the extension exposes one, else null. */
  configJsonSchema: Record<string, unknown> | null;
  /** Field names a UI must mask. */
  requiredSecrets: string[];
  tier: ExtensionConfigTier;
};

/**
 * A JSON-schema is "meaningful" (worth an auto-form) when it describes config
 * fields beyond the base `enabled` toggle. A schema whose only property is
 * `enabled` is treated as toggle-only.
 */
function hasMeaningfulSchema(
  schema: Record<string, unknown> | null | undefined
): boolean {
  if (!schema) return false;
  const properties = schema.properties;
  if (properties === undefined) {
    // No `properties` key at all — e.g. a passthrough/record schema. Treat any
    // non-empty schema object as meaningful config.
    return Object.keys(schema).length > 0;
  }
  if (typeof properties !== "object" || properties === null) return false;
  const keys = Object.keys(properties as Record<string, unknown>).filter(
    (key) => key !== "enabled"
  );
  return keys.length > 0;
}

function resolveTier(
  routePrefixes: string[],
  configJsonSchema: Record<string, unknown> | null
): ExtensionConfigTier {
  if (routePrefixes.length > 0) return "bespoke-route";
  if (hasMeaningfulSchema(configJsonSchema)) return "auto-form";
  return "toggle-only";
}

function isEnabledForAgent(agent: AgentConfig, extensionId: string): boolean {
  const extensions = agent.extensions as Record<string, unknown> | undefined;
  if (!extensions || !(extensionId in extensions)) return false;
  const value = extensions[extensionId];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as { enabled?: unknown }).enabled !== false;
}

function toCatalogEntry(
  extension: Extension,
  routePrefixes: string[],
  builtIn: boolean,
  agent: AgentConfig
): ExtensionCatalogEntry {
  const configJsonSchema = extension.configJsonSchema ?? null;
  return {
    id: extension.id,
    displayName: extension.displayName,
    description: extension.description,
    builtIn,
    enabled: isEnabledForAgent(agent, extension.id),
    configJsonSchema,
    requiredSecrets: extension.requiredSecrets ?? [],
    tier: resolveTier(routePrefixes, configJsonSchema),
  };
}

/**
 * Build the full extension catalog for one agent: every available extension
 * (built-in static registry + runtime scan of the external extensions dir),
 * each with its per-agent enabled state and config metadata.
 *
 * Accuracy is the contract: an extension appears iff it is actually available
 * (a built-in package that loads, or an external dir that parses as a valid
 * extension). Built-ins whose package cannot be loaded are skipped so we never
 * surface a ghost. External ids that collide with a built-in id are dropped
 * (the built-in already covers that id).
 */
export async function buildExtensionCatalog(
  config: GatewayConfig,
  agent: AgentConfig
): Promise<ExtensionCatalogEntry[]> {
  const entries: ExtensionCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const registration of getBuiltInExtensionRegistrations()) {
    let extension: Extension;
    try {
      extension = await registration.load();
    } catch {
      // Package not installed in this deployment — not actually available, so
      // it must not appear in the catalog (no ghosts).
      continue;
    }
    if (seen.has(extension.id)) continue;
    seen.add(extension.id);
    entries.push(
      toCatalogEntry(extension, registration.routePrefixes, true, agent)
    );
  }

  const external = await discoverExternalExtensions(
    getExternalExtensionsPath(config)
  );
  for (const { extension } of external) {
    if (seen.has(extension.id)) continue;
    seen.add(extension.id);
    entries.push(
      toCatalogEntry(extension, extension.routePrefixes, false, agent)
    );
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}
