import {
  createContainerHttpClient,
  type ContainerHttpClient,
  type ContainerOnecliConfig,
} from "./http-client.js";

export type OnecliProxyConfig = ContainerOnecliConfig;

export type ExtensionHttpClient = ContainerHttpClient;

export let proxyClient: ExtensionHttpClient = createContainerHttpClient();

export function configureProxy(
  onecliConfig?: OnecliProxyConfig
): ExtensionHttpClient {
  proxyClient = createContainerHttpClient(onecliConfig);
  return proxyClient;
}
