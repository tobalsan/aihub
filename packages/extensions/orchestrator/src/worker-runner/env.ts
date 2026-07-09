export function sanitizedWorkerEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.LINEAR_API_KEY;
  delete env.PLANE_API_KEY;
  delete env.PLANE_OAUTH_TOKEN;
  delete env.PLANE_BOT_TOKEN;
  return env;
}
