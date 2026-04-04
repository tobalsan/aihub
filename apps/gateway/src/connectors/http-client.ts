import fs from "node:fs";
import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";

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

export function createHttpClient(
  options: CreateHttpClientOptions
): ConnectorHttpClient {
  const dispatcher = createDispatcher(options.onecli);

  if (!options.onecli?.enabled) {
    return {
      async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
        return globalThis.fetch(input, mergeInit(init, options, dispatcher));
      },
    };
  }

  return {
    async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
      return globalThis.fetch(input, mergeInit(init, options, dispatcher));
    },
  };
}

function mergeInit(
  init: RequestInit | undefined,
  options: CreateHttpClientOptions,
  dispatcher?: Dispatcher
): RequestInit {
  const mergedHeaders = new Headers(options.headers);
  const initHeaders = new Headers(init?.headers);
  for (const [key, value] of initHeaders.entries()) {
    mergedHeaders.set(key, value);
  }

  const merged: RequestInit & { dispatcher?: Dispatcher } = {
    ...init,
    headers: mergedHeaders,
  };

  if (options.timeoutMs && !init?.signal) {
    merged.signal = AbortSignal.timeout(options.timeoutMs);
  }

  if (dispatcher) {
    merged.dispatcher = dispatcher;
  }

  return merged;
}

function createDispatcher(
  onecli: OnecliRuntimeConfig | undefined
): Dispatcher | undefined {
  if (!onecli?.enabled) {
    return undefined;
  }

  const requestTls = onecli.caPath
    ? { ca: fs.readFileSync(onecli.caPath, "utf8") }
    : undefined;

  return new ProxyAgent({
    uri: buildProxyUrl(onecli),
    ...(requestTls ? { requestTls } : {}),
  });
}

function buildProxyUrl(onecli: OnecliRuntimeConfig): string {
  const url = new URL(onecli.gatewayUrl);
  if (onecli.gatewayToken) {
    url.username = "onecli";
    url.password = onecli.gatewayToken;
  }
  return url.toString().replace(/\/$/, "");
}
