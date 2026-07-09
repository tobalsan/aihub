import type { PlaneAuthKind } from "../types.js";

export type PlaneAuth = { kind: PlaneAuthKind; token: string };

export function planeAuthHeaders(auth: PlaneAuth): Record<string, string> {
  return auth.kind === "api_key"
    ? { "x-api-key": auth.token }
    : { authorization: `Bearer ${auth.token}` };
}

export function resolvePlaneEnvAuth(env: NodeJS.ProcessEnv = process.env): PlaneAuth | undefined {
  const bot = env.PLANE_BOT_TOKEN?.trim();
  if (bot) return { kind: "bot_token", token: bot };
  const oauth = env.PLANE_OAUTH_TOKEN?.trim();
  if (oauth) return { kind: "oauth_token", token: oauth };
  const api = env.PLANE_API_KEY?.trim();
  if (api) return { kind: "api_key", token: api };
  return undefined;
}

export function planeAuthEnvRef(kind: PlaneAuthKind): string {
  if (kind === "bot_token") return "$PLANE_BOT_TOKEN";
  if (kind === "oauth_token") return "$PLANE_OAUTH_TOKEN";
  return "$PLANE_API_KEY";
}
