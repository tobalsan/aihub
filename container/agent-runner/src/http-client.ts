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
  // Rely on NODE_EXTRA_CA_CERTS (set via container env) for the OneCLI CA.
  // Passing requestTls: { ca } here would replace the system CA chain,
  // breaking HTTPS CONNECT tunneling which needs both the OneCLI CA and
  // standard root CAs.
  setGlobalDispatcher(new EnvHttpProxyAgent());
  globalProxyInstalled = true;
}

function createDispatcher(
  onecliConfig: ContainerOnecliConfig | undefined
): Dispatcher | undefined {
  if (!onecliConfig?.enabled) {
    return undefined;
  }

  return new ProxyAgent({
    uri: onecliConfig.url.replace(/\/$/, ""),
  });
}
