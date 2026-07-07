import { z } from "zod";

/**
 * A provider descriptor is pure data: adding a new OAuth provider (Gmail,
 * Dropbox, ...) is a matter of adding one of these, not writing new flow code.
 * The authorize + callback routes and the token store are provider-agnostic and
 * read everything they need from the descriptor.
 */
export interface OAuthProviderDescriptor {
  /** Stable id used in routes and storage, e.g. "google". */
  id: string;
  /** Human-facing name, e.g. "Google". */
  displayName: string;
  /** OAuth 2.0 authorization endpoint. */
  authorizeUrl: string;
  /** OAuth 2.0 token endpoint. */
  tokenUrl: string;
  /**
   * Endpoint used to fetch the connected account identity after token
   * exchange (so the UI can show "Connected as alice@example.com").
   */
  userInfoUrl?: string;
  /** Default scopes requested when a consumer does not override them. */
  defaultScopes: string[];
  /**
   * Extra query params appended to the authorize URL. For Google we need
   * access_type=offline + prompt=consent to be handed a refresh token, even
   * though this slice does not yet use refresh.
   */
  authorizeParams?: Record<string, string>;
  /**
   * Given a parsed userinfo response, extract a stable, human-readable account
   * label (usually the email). Returns undefined when it cannot be determined.
   */
  extractAccount?(userInfo: unknown): string | undefined;
}

/**
 * A stored connection, scoped to a single (agent, provider) pair. There is no
 * per-user dimension in this slice: one workspace/agent has at most one
 * connection per provider.
 */
export const OAuthConnectionSchema = z.object({
  agentId: z.string(),
  provider: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  /** Epoch millis when the access token expires, if known. */
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()).default([]),
  /** Human-readable connected account, e.g. the Google email. */
  account: z.string().optional(),
  tokenType: z.string().optional(),
  connectedAt: z.number(),
  updatedAt: z.number(),
});
export type OAuthConnection = z.infer<typeof OAuthConnectionSchema>;

/**
 * The result of resolving an OAuth requirement at tool-build time. It carries a
 * fresh access token when connected, or a clear, structured not-connected
 * signal otherwise — never a raw secret and never a thrown 401.
 */
export type ResolvedOAuth =
  | {
      connected: true;
      provider: string;
      accessToken: string;
      account?: string;
      scopes: string[];
      expiresAt?: number;
    }
  | {
      connected: false;
      provider: string;
      reason: OAuthNotConnectedReason;
      /** URL the UI/agent can point the operator/user at to connect. */
      authorizeUrl?: string;
      message: string;
    };

export type OAuthNotConnectedReason =
  | "not_connected"
  | "provider_not_configured"
  | "expired";

/**
 * Declared by a tool extension: "I need a token for this provider/scopes".
 */
export interface OAuthRequirement {
  provider: string;
  scopes?: string[];
}
