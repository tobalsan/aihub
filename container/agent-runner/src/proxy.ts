import {
  createContainerHttpClient,
  type ContainerHttpClient,
  type ContainerOnecliConfig,
} from "./http-client.js";

export type OnecliProxyConfig = ContainerOnecliConfig;

export type ConnectorHttpClient = ContainerHttpClient;

export function configureProxy(
  onecliConfig?: OnecliProxyConfig
): ConnectorHttpClient {
  return createContainerHttpClient(onecliConfig);
}
