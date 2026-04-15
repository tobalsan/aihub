import fs from "node:fs";
import type { Dispatcher } from "undici";
import { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from "undici";

export type ContainerOnecliConfig = {
  enabled: boolean;
  url: string;
  caPath?: string;
};

export type ContainerHttpClient = {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
};

export function createContainerHttpClient(
  onecliConfig?: ContainerOnecliConfig
): ContainerHttpClient {
  const dispatcher = createDispatcher(onecliConfig);
  installGlobalProxy(onecliConfig);

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

let globalProxyInstalled = false;

function installGlobalProxy(
  onecliConfig: ContainerOnecliConfig | undefined
): void {
  if (globalProxyInstalled || !onecliConfig?.enabled) {
    return;
  }
  const requestTls = onecliConfig.caPath
    ? { ca: fs.readFileSync(onecliConfig.caPath, "utf8") }
    : undefined;
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      ...(requestTls ? { requestTls } : {}),
    })
  );
  globalProxyInstalled = true;
}

function createDispatcher(
  onecliConfig: ContainerOnecliConfig | undefined
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
