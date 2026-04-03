import type { GatewayConfig } from "@aihub/shared";

export type OnecliEnv = {
  HTTP_PROXY: string;
  HTTPS_PROXY: string;
  NODE_EXTRA_CA_CERTS?: string;
  SSL_CERT_FILE?: string;
  REQUESTS_CA_BUNDLE?: string;
};

export function buildOnecliEnv(
  config: GatewayConfig,
  agentId: string
): OnecliEnv | null {
  const onecli = config.onecli;
  if (!onecli?.enabled) return null;

  const agentConfig = onecli.agents?.[agentId];
  if (agentConfig?.enabled === false) return null;

  let proxyUrl = onecli.gatewayUrl;
  if (agentConfig?.gatewayToken) {
    const url = new URL(onecli.gatewayUrl);
    url.username = "onecli";
    url.password = agentConfig.gatewayToken;
    proxyUrl = url.toString().replace(/\/$/, "");
  }

  const env: OnecliEnv = {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
  };

  if (onecli.ca?.source === "file") {
    env.NODE_EXTRA_CA_CERTS = onecli.ca.path;
    env.SSL_CERT_FILE = onecli.ca.path;
    env.REQUESTS_CA_BUNDLE = onecli.ca.path;
  }

  return env;
}
