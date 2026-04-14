export async function callGatewayTool(
  gatewayUrl: string,
  agentToken: string,
  tool: string,
  args: unknown,
  agentId = ""
): Promise<unknown> {
  const response = await fetch(new URL("/internal/tools", gatewayUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Agent-Id": agentId,
      "X-Agent-Token": agentToken,
    },
    body: JSON.stringify({
      tool,
      args,
      agentId,
      agentToken,
    }),
  });

  const result = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Gateway tool ${tool} failed with ${response.status}`);
  }

  return result;
}
