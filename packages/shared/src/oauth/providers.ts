import type { OAuthProviderDescriptor } from "./types.js";

/**
 * Google descriptor. This is the whole "how to talk to Google" definition —
 * adding Gmail read-only later is just a new descriptor + a client id/secret,
 * with no changes to the authorize/callback/token-store machinery.
 */
export const googleProvider: OAuthProviderDescriptor = {
  id: "google",
  displayName: "Google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  defaultScopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  authorizeParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  extractAccount(userInfo) {
    if (
      userInfo &&
      typeof userInfo === "object" &&
      "email" in userInfo &&
      typeof (userInfo as { email?: unknown }).email === "string"
    ) {
      return (userInfo as { email: string }).email;
    }
    return undefined;
  },
};

const PROVIDER_LIST: OAuthProviderDescriptor[] = [googleProvider];

const PROVIDER_REGISTRY = new Map<string, OAuthProviderDescriptor>(
  PROVIDER_LIST.map((provider) => [provider.id, provider])
);

export function getOAuthProvider(
  id: string
): OAuthProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.get(id);
}

export function listOAuthProviders(): OAuthProviderDescriptor[] {
  return [...PROVIDER_REGISTRY.values()];
}
