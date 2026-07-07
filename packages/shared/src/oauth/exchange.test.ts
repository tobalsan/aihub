import { describe, expect, it, vi } from "vitest";
import { googleProvider } from "./providers.js";
import {
  OAuthRefreshError,
  refreshAccessToken,
  revokeToken,
} from "./exchange.js";

const credentials = { clientId: "cid", clientSecret: "csecret" };

describe("refreshAccessToken", () => {
  it("exchanges a refresh token for a fresh access token (faked Google endpoint)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(googleProvider.tokenUrl);
      const body = new URLSearchParams((init?.body as string) ?? "");
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("REFRESH-1");
      expect(body.get("client_secret")).toBe("csecret");
      return new Response(
        JSON.stringify({ access_token: "NEW", expires_in: 3600, token_type: "Bearer" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await refreshAccessToken(
      { provider: googleProvider, credentials, refreshToken: "REFRESH-1" },
      fetchImpl as unknown as typeof fetch
    );
    expect(result.accessToken).toBe("NEW");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("marks a 4xx OAuth error (invalid_grant) as unrecoverable", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      refreshAccessToken(
        { provider: googleProvider, credentials, refreshToken: "DEAD" },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ name: "OAuthRefreshError", unrecoverable: true });
  });

  it("marks a transient 429 (rate limit) as recoverable, not a dead grant", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "rate_limit_exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      refreshAccessToken(
        { provider: googleProvider, credentials, refreshToken: "R" },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ name: "OAuthRefreshError", unrecoverable: false });
  });

  it("marks a 5xx as transient (recoverable)", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      refreshAccessToken(
        { provider: googleProvider, credentials, refreshToken: "R" },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ name: "OAuthRefreshError", unrecoverable: false });
  });

  it("marks a network failure as transient (recoverable)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const error = await refreshAccessToken(
      { provider: googleProvider, credentials, refreshToken: "R" },
      fetchImpl as unknown as typeof fetch
    ).catch((e) => e);
    expect(error).toBeInstanceOf(OAuthRefreshError);
    expect((error as OAuthRefreshError).unrecoverable).toBe(false);
  });
});

describe("revokeToken", () => {
  it("posts the token to the provider revoke endpoint and returns true on 200", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(googleProvider.revokeUrl);
      const body = new URLSearchParams((init?.body as string) ?? "");
      expect(body.get("token")).toBe("TOK");
      return new Response(null, { status: 200 });
    });
    const ok = await revokeToken(
      googleProvider,
      "TOK",
      fetchImpl as unknown as typeof fetch
    );
    expect(ok).toBe(true);
  });

  it("never throws when revoke fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    const ok = await revokeToken(
      googleProvider,
      "TOK",
      fetchImpl as unknown as typeof fetch
    );
    expect(ok).toBe(false);
  });
});
