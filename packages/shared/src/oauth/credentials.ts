/**
 * Client credentials for one OAuth provider (the operator's BYO OAuth app).
 * Distinct from the per-connection user tokens: these identify the OAuth
 * *client*, not the connected account.
 */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Pluggable source of OAuth client credentials. BYO (operator drops their own
 * client id/secret into instance config/env) is mode one. Future modes — a
 * shared managed app, a per-agent vault, etc. — implement this same interface
 * so the flow code never learns where the credentials came from.
 */
export interface OAuthCredentialSource {
  /** Returns the client credentials for a provider, or undefined if none configured. */
  getClientCredentials(
    provider: string
  ): OAuthClientCredentials | undefined | Promise<OAuthClientCredentials | undefined>;
}

/**
 * BYO credential source: reads client id/secret from a static map, typically
 * built from instance config (with `$env:` refs already resolved by the host).
 */
export class ByoCredentialSource implements OAuthCredentialSource {
  #byProvider: Map<string, OAuthClientCredentials>;

  constructor(
    credentials: Record<string, OAuthClientCredentials | undefined> = {}
  ) {
    this.#byProvider = new Map(
      Object.entries(credentials).filter(
        (entry): entry is [string, OAuthClientCredentials] =>
          entry[1] !== undefined &&
          Boolean(entry[1].clientId) &&
          Boolean(entry[1].clientSecret)
      )
    );
  }

  getClientCredentials(provider: string): OAuthClientCredentials | undefined {
    return this.#byProvider.get(provider);
  }
}
