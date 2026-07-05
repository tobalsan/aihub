import { API_BASE, apiFetch as fetch } from "./core";

export type ExtensionConfigTier =
  | "auto-form"
  | "bespoke-route"
  | "toggle-only";

export type ExtensionCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  builtIn: boolean;
  enabled: boolean;
  configJsonSchema: Record<string, unknown> | null;
  requiredSecrets: string[];
  tier: ExtensionConfigTier;
};

// Admin-only: the full extension catalog for one agent (built-in + runtime
// scanned), each with its per-agent enabled state and config metadata.
export async function fetchAgentExtensions(
  agentId: string
): Promise<ExtensionCatalogEntry[]> {
  const res = await fetch(
    `${API_BASE}/agents/${encodeURIComponent(agentId)}/extensions`
  );
  if (!res.ok) throw new Error("Failed to fetch extension catalog");
  const data = (await res.json()) as { extensions: ExtensionCatalogEntry[] };
  return data.extensions;
}
