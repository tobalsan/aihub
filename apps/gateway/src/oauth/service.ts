import {
  ByoCredentialSource,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchAccountLabel,
  generatePkce,
  generateState,
  getOAuthProvider,
  type GatewayConfig,
  type OAuthConnection,
  type OAuthCredentialSource,
  type OAuthFetch,
  type OAuthProviderDescriptor,
  type OAuthRequirement,
  type ResolvedOAuth,
} from "@aihub/shared";
import { loadConfig } from "../config/index.js";
import { OAuthConnectionStore, getOAuthConnectionStore } from "./store.js";

/** A short-lived pending authorization awaiting the provider callback. */
interface PendingAuth {
  agentId: string;
  provider: string;
  codeVerifier: string;
  redirectUri: string;
  scopes: string[];
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Resolve `$env:` refs in BYO provider credentials. The runtime `loadConfig()`
 * does not resolve env refs (that only happens on the async validate path, which
 * does not feed the runtime cache), so OAuth resolves them here — the same
 * `$env:` contract every other extension secret uses.
 */
function resolveProviderEnvRefs(
  providers: NonNullable<GatewayConfig["oauth"]>["providers"]
): Record<string, { clientId: string; clientSecret: string }> {
  const resolveRef = (value: string): string => {
    if (!value.startsWith("$env:")) return value;
    const envName = value.slice("$env:".length);
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(
        `Env var "${envName}" not set (referenced in oauth.providers config)`
      );
    }
    return envValue;
  };
  const resolved: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const [id, creds] of Object.entries(providers ?? {})) {
    if (!creds) continue;
    resolved[id] = {
      clientId: resolveRef(creds.clientId),
      clientSecret: resolveRef(creds.clientSecret),
    };
  }
  return resolved;
}

export interface OAuthServiceDeps {
  store?: OAuthConnectionStore;
  fetchImpl?: OAuthFetch;
  loadConfig?: () => GatewayConfig;
}

export interface StartAuthResult {
  authorizeUrl: string;
  state: string;
}

/**
 * Orchestrates the provider-agnostic OAuth flow: builds authorize URLs with
 * state + PKCE, exchanges callback codes for tokens, persists a single
 * agent/provider-scoped connection, and resolves fresh tokens for extensions.
 */
export class OAuthService {
  #store: OAuthConnectionStore;
  #fetch: OAuthFetch;
  #loadConfig: () => GatewayConfig;
  #pending = new Map<string, PendingAuth>();

  constructor(deps: OAuthServiceDeps = {}) {
    this.#store = deps.store ?? getOAuthConnectionStore();
    this.#fetch = deps.fetchImpl ?? fetch;
    this.#loadConfig = deps.loadConfig ?? loadConfig;
  }

  #credentialSource(config: GatewayConfig): OAuthCredentialSource {
    return new ByoCredentialSource(
      resolveProviderEnvRefs(config.oauth?.providers ?? {})
    );
  }

  #redirectUri(config: GatewayConfig, provider: string): string {
    const base = (config.oauth?.redirectBaseUrl ?? "http://localhost:4000").replace(
      /\/+$/,
      ""
    );
    return `${base}/api/oauth/${provider}/callback`;
  }

  #resolveProvider(providerId: string): OAuthProviderDescriptor {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth provider "${providerId}"`);
    }
    return provider;
  }

  #cleanupPending(): void {
    const now = Date.now();
    for (const [state, pending] of this.#pending) {
      if (now - pending.createdAt > PENDING_TTL_MS) this.#pending.delete(state);
    }
  }

  /** Begin an authorization: returns the provider authorize URL to redirect to. */
  async startAuthorization(input: {
    agentId: string;
    provider: string;
    scopes?: string[];
  }): Promise<StartAuthResult> {
    const config = this.#loadConfig();
    const provider = this.#resolveProvider(input.provider);
    const credentials = await this.#credentialSource(config).getClientCredentials(
      provider.id
    );
    if (!credentials) {
      throw new Error(
        `No OAuth client configured for provider "${provider.id}". Set oauth.providers.${provider.id} in config.`
      );
    }

    const pkce = generatePkce();
    const state = generateState();
    const redirectUri = this.#redirectUri(config, provider.id);
    const scopes =
      input.scopes && input.scopes.length > 0
        ? input.scopes
        : provider.defaultScopes;

    this.#cleanupPending();
    this.#pending.set(state, {
      agentId: input.agentId,
      provider: provider.id,
      codeVerifier: pkce.verifier,
      redirectUri,
      scopes,
      createdAt: Date.now(),
    });

    const authorizeUrl = buildAuthorizeUrl({
      provider,
      clientId: credentials.clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge: pkce.challenge,
    });
    return { authorizeUrl, state };
  }

  /** Handle the provider callback: exchange the code and persist the connection. */
  async handleCallback(input: {
    provider: string;
    code: string;
    state: string;
  }): Promise<OAuthConnection> {
    const pending = this.#pending.get(input.state);
    if (!pending) {
      throw new Error("Invalid or expired OAuth state");
    }
    if (pending.provider !== input.provider) {
      throw new Error("OAuth provider mismatch for state");
    }
    this.#pending.delete(input.state);

    const config = this.#loadConfig();
    const provider = this.#resolveProvider(input.provider);
    const credentials = await this.#credentialSource(config).getClientCredentials(
      provider.id
    );
    if (!credentials) {
      throw new Error(`No OAuth client configured for provider "${provider.id}"`);
    }

    const tokens = await exchangeCodeForTokens(
      {
        provider,
        credentials,
        code: input.code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.codeVerifier,
      },
      this.#fetch
    );

    const account = await fetchAccountLabel(
      provider,
      tokens.accessToken,
      this.#fetch
    );

    const now = Date.now();
    const connection: OAuthConnection = {
      agentId: pending.agentId,
      provider: provider.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes.length > 0 ? tokens.scopes : pending.scopes,
      account,
      tokenType: tokens.tokenType,
      connectedAt: now,
      updatedAt: now,
    };
    return this.#store.save(connection);
  }

  /** Current connection status for a (agent, provider) pair. */
  getConnection(agentId: string, provider: string): OAuthConnection | undefined {
    return this.#store.get(agentId, provider);
  }

  disconnect(agentId: string, provider: string): void {
    this.#store.delete(agentId, provider);
  }

  /**
   * Resolve a fresh token for an extension's declared requirement. Returns a
   * structured not-connected signal instead of throwing when there is no
   * connection or the provider is not configured.
   *
   * No refresh in this slice: an expired token yields `reason: "expired"`.
   */
  async resolveToken(
    agentId: string,
    requirement: OAuthRequirement
  ): Promise<ResolvedOAuth> {
    const config = this.#loadConfig();
    const provider = getOAuthProvider(requirement.provider);
    if (!provider) {
      return {
        connected: false,
        provider: requirement.provider,
        reason: "provider_not_configured",
        message: `Unknown OAuth provider "${requirement.provider}".`,
      };
    }

    const credentials = await this.#credentialSource(config).getClientCredentials(
      provider.id
    );
    const authorizeUrl = `${this.#redirectUri(config, provider.id).replace(
      /\/callback$/,
      "/authorize"
    )}?agent=${encodeURIComponent(agentId)}`;

    if (!credentials) {
      return {
        connected: false,
        provider: provider.id,
        reason: "provider_not_configured",
        message: `No OAuth client configured for provider "${provider.id}".`,
        authorizeUrl,
      };
    }

    const connection = this.#store.get(agentId, provider.id);
    if (!connection) {
      return {
        connected: false,
        provider: provider.id,
        reason: "not_connected",
        message: `${provider.displayName} is not connected for agent "${agentId}".`,
        authorizeUrl,
      };
    }

    if (connection.expiresAt && connection.expiresAt <= Date.now()) {
      return {
        connected: false,
        provider: provider.id,
        reason: "expired",
        message: `${provider.displayName} token expired; reconnect required.`,
        authorizeUrl,
      };
    }

    return {
      connected: true,
      provider: provider.id,
      accessToken: connection.accessToken,
      account: connection.account,
      scopes: connection.scopes,
      expiresAt: connection.expiresAt,
    };
  }
}

let defaultService: OAuthService | undefined;

export function getOAuthService(): OAuthService {
  defaultService ??= new OAuthService();
  return defaultService;
}
