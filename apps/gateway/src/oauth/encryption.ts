import { loadConfig } from "../config/index.js";
import { TokenCipher } from "./crypto.js";

/**
 * Resolve the OAuth token-at-rest encryption secret from instance config
 * (`oauth.encryptionKey`) and build a {@link TokenCipher} from it.
 *
 * The secret follows the same `$env:` contract as every other operator secret:
 * `oauth.encryptionKey: "$env:AIHUB_OAUTH_ENCRYPTION_KEY"` resolves the value
 * from the environment (loaded from `$AIHUB_HOME/.env` or the process env).
 *
 * When no secret is configured, returns `undefined` and logs a one-time warning:
 * the store then persists tokens in plaintext. That keeps zero-config local/dev
 * setups working while making the operator's choice explicit for production.
 */

let warned = false;

function resolveEnvRef(value: string): string {
  if (!value.startsWith("$env:")) return value;
  const envName = value.slice("$env:".length);
  const envValue = process.env[envName];
  if (envValue === undefined || envValue === "") {
    throw new Error(
      `Env var "${envName}" not set (referenced in oauth.encryptionKey)`
    );
  }
  return envValue;
}

export function resolveTokenCipher(
  loadConfigImpl: typeof loadConfig = loadConfig
): TokenCipher | undefined {
  let secretRef: string | undefined;
  try {
    secretRef = loadConfigImpl().oauth?.encryptionKey;
  } catch {
    // Config not loadable in this context (e.g. some tests): no cipher.
    return undefined;
  }

  if (!secretRef) {
    if (!warned) {
      warned = true;
      console.warn(
        "[oauth] oauth.encryptionKey is not set — OAuth tokens are stored in " +
          "PLAINTEXT. Set oauth.encryptionKey (e.g. $env:AIHUB_OAUTH_ENCRYPTION_KEY) " +
          "to encrypt tokens at rest."
      );
    }
    return undefined;
  }

  return new TokenCipher(resolveEnvRef(secretRef));
}
