import type { OnecliEnv } from "../config/onecli.js";

export type OnecliRuntimeConfig = {
  enabled: boolean;
  gatewayUrl: string;
  gatewayToken?: string;
  caPath?: string;
};

export type CreateHttpClientOptions = {
  connectorId: string;
  onecli?: OnecliRuntimeConfig;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type ConnectorHttpClient = {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
};

let connectorEnvLock: Promise<void> = Promise.resolve();

export function createHttpClient(
  options: CreateHttpClientOptions
): ConnectorHttpClient {
  if (!options.onecli?.enabled) {
    return {
      async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
        return globalThis.fetch(input, mergeInit(init, options));
      },
    };
  }

  const onecli = options.onecli;

  return {
    async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
      return withOnecliEnv(buildOnecliEnv(onecli), async () =>
        globalThis.fetch(input, mergeInit(init, options))
      );
    },
  };
}

function mergeInit(
  init: RequestInit | undefined,
  options: CreateHttpClientOptions
): RequestInit {
  const mergedHeaders = new Headers(options.headers);
  const initHeaders = new Headers(init?.headers);
  for (const [key, value] of initHeaders.entries()) {
    mergedHeaders.set(key, value);
  }

  const merged: RequestInit = {
    ...init,
    headers: mergedHeaders,
  };

  if (options.timeoutMs && !init?.signal) {
    merged.signal = AbortSignal.timeout(options.timeoutMs);
  }

  return merged;
}

function buildOnecliEnv(onecli: OnecliRuntimeConfig): OnecliEnv {
  let proxyUrl = onecli.gatewayUrl;
  if (onecli.gatewayToken) {
    const url = new URL(onecli.gatewayUrl);
    url.username = "onecli";
    url.password = onecli.gatewayToken;
    proxyUrl = url.toString().replace(/\/$/, "");
  }

  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ...(onecli.caPath
      ? {
          NODE_EXTRA_CA_CERTS: onecli.caPath,
          SSL_CERT_FILE: onecli.caPath,
          REQUESTS_CA_BUNDLE: onecli.caPath,
        }
      : {}),
  };
}

async function withOnecliEnv<T>(
  env: OnecliEnv,
  fn: () => Promise<T>
): Promise<T> {
  const previousLock = connectorEnvLock;
  let releaseLock!: () => void;
  connectorEnvLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;

  const saved = applyProxyEnv(env);
  try {
    return await fn();
  } finally {
    restoreEnv(saved);
    releaseLock();
  }
}

function applyProxyEnv(env: OnecliEnv): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }

  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}
