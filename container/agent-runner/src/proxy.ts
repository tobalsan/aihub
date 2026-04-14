import fs from "node:fs";
import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";

export type OnecliProxyConfig = {
  enabled: boolean;
  url: string;
  caPath?: string;
};

export type ConnectorHttpClient = {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
};

export function configureProxy(
  onecliConfig?: OnecliProxyConfig
): ConnectorHttpClient {
  const dispatcher = createDispatcher(onecliConfig);

  return {
    async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
      return globalThis.fetch(input, mergeInit(init, dispatcher));
    },
  };
}

function mergeInit(
  init: RequestInit | undefined,
  dispatcher?: Dispatcher
): RequestInit {
  if (!dispatcher) {
    return init ?? {};
  }

  return {
    ...init,
    dispatcher,
  } as RequestInit & { dispatcher: Dispatcher };
}

function createDispatcher(
  onecliConfig: OnecliProxyConfig | undefined
): Dispatcher | undefined {
  if (!onecliConfig?.enabled) {
    return undefined;
  }

  const requestTls = onecliConfig.caPath
    ? { ca: fs.readFileSync(onecliConfig.caPath, "utf8") }
    : undefined;

  return new ProxyAgent({
    uri: onecliConfig.url.replace(/\/$/, ""),
    ...(requestTls ? { requestTls } : {}),
  });
}
