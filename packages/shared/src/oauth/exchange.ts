import type { OAuthClientCredentials } from "./credentials.js";
import type { OAuthProviderDescriptor } from "./types.js";

/** Injectable fetch so tests can fake Google's token/userinfo endpoints. */
export type OAuthFetch = typeof fetch;

export interface TokenExchangeInput {
  provider: OAuthProviderDescriptor;
  credentials: OAuthClientCredentials;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  tokenType?: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange an authorization code for tokens at the provider's token endpoint.
 * Provider-agnostic: everything provider-specific comes from the descriptor.
 */
export async function exchangeCodeForTokens(
  input: TokenExchangeInput,
  fetchImpl: OAuthFetch = fetch
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    code_verifier: input.codeVerifier,
  });

  const response = await fetchImpl(input.provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const raw = (await response.json().catch(() => ({}))) as RawTokenResponse;
  if (!response.ok || raw.error || !raw.access_token) {
    const detail = raw.error_description || raw.error || `HTTP ${response.status}`;
    throw new Error(`OAuth token exchange failed: ${detail}`);
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt:
      typeof raw.expires_in === "number"
        ? Date.now() + raw.expires_in * 1000
        : undefined,
    scopes: raw.scope ? raw.scope.split(/\s+/).filter(Boolean) : [],
    tokenType: raw.token_type,
  };
}

/**
 * Fetch the connected account identity so the UI can display "Connected as
 * <email>". Best-effort: failure just yields undefined, it does not break the
 * connect flow.
 */
export async function fetchAccountLabel(
  provider: OAuthProviderDescriptor,
  accessToken: string,
  fetchImpl: OAuthFetch = fetch
): Promise<string | undefined> {
  if (!provider.userInfoUrl || !provider.extractAccount) return undefined;
  try {
    const response = await fetchImpl(provider.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const userInfo = await response.json().catch(() => undefined);
    return provider.extractAccount(userInfo);
  } catch {
    return undefined;
  }
}

/** Build the provider authorize URL with state + PKCE challenge. */
export function buildAuthorizeUrl(input: {
  provider: OAuthProviderDescriptor;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(input.provider.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
