const activeTokens = new Map<
  string,
  { agentId: string; containerName: string; createdAt: number }
>();

export function registerContainerToken(
  token: string,
  agentId: string,
  containerName: string
): void {
  activeTokens.set(token, { agentId, containerName, createdAt: Date.now() });
}

export function validateContainerToken(
  token: string,
  agentId: string
): boolean {
  return activeTokens.get(token)?.agentId === agentId;
}

export function removeContainerToken(token: string): void {
  activeTokens.delete(token);
}
