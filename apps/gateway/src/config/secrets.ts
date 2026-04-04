function isSecretRef(value: string): boolean {
  return value.startsWith("$env:");
}

export async function resolveSecretValue(value: string): Promise<string> {
  if (value.startsWith("$secret:")) {
    const name = value.slice("$secret:".length);
    throw new Error(
      `Secret "${name}" uses removed $secret: resolution. Use $env:${name} or native top-level onecli proxy config instead.`
    );
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

export async function resolveConfigSecrets<T>(config: T): Promise<T> {
  async function walk(value: unknown): Promise<unknown> {
    if (typeof value === "string") {
      if (value.startsWith("$secret:")) {
        return resolveSecretValue(value);
      }
      return isSecretRef(value) ? resolveSecretValue(value) : value;
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
