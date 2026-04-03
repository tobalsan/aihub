import type { SecretsConfig } from "@aihub/shared";

function isSecretRef(value: string): boolean {
  return value.startsWith("$secret:") || value.startsWith("$env:");
}

export async function resolveSecretValue(
  value: string,
  secretsConfig?: SecretsConfig
): Promise<string> {
  if (value.startsWith("$secret:")) {
    const name = value.slice("$secret:".length);
    if (secretsConfig?.provider !== "onecli" || !secretsConfig.gatewayUrl) {
      throw new Error(
        `Secret "${name}" requires secrets.provider="onecli" with gatewayUrl`
      );
    }

    console.warn(
      `[secrets] DEPRECATED: Resolving secret "${name}" via OneCLI secret lookup. ` +
        "This will be removed in a future version. Migrate to native OneCLI proxy integration."
    );

    const response = await fetch(
      `${secretsConfig.gatewayUrl.replace(/\/$/, "")}/secrets/${name}`
    );
    if (!response.ok) {
      throw new Error(`Secret "${name}" not found in OneCLI vault`);
    }

    const data = (await response.json()) as { value?: unknown };
    if (typeof data.value !== "string") {
      throw new Error(`Secret "${name}" resolved to invalid value`);
    }
    return data.value;
  }

  if (value.startsWith("$env:")) {
    const envName = value.slice("$env:".length);
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(`Env var "${envName}" not set`);
    }
    return envValue;
  }

  return value;
}

export async function resolveConfigSecrets<T>(
  config: T,
  secretsConfig?: SecretsConfig
): Promise<T> {
  async function walk(value: unknown): Promise<unknown> {
    if (typeof value === "string") {
      return isSecretRef(value)
        ? resolveSecretValue(value, secretsConfig)
        : value;
    }
    if (Array.isArray(value)) {
      const resolved = await Promise.all(value.map((entry) => walk(entry)));
      return resolved;
    }
    if (value && typeof value === "object") {
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [key, await walk(entry)])
      );
      return Object.fromEntries(entries);
    }
    return value;
  }

  return (await walk(config)) as T;
}
