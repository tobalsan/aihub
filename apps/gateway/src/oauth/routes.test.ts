import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import { createOAuthRoutes } from "./routes.js";
import { OAuthService } from "./service.js";
import { OAuthConnectionStore } from "./store.js";

function makeConfig(): GatewayConfig {
  return {
    agents: [],
    extensions: {},
    oauth: {
      redirectBaseUrl: "http://localhost:4000",
      providers: { google: { clientId: "cid", clientSecret: "csecret" } },
    },
  } as unknown as GatewayConfig;
}

describe("oauth routes", () => {
  let tmpDir: string;
  let store: OAuthConnectionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-routes-"));
    store = new OAuthConnectionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("authorize redirects to Google, then callback exchanges the code → connected", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("token")) {
        return new Response(
          JSON.stringify({ access_token: "A1", expires_in: 3600, token_type: "Bearer" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ email: "alice@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const service = new OAuthService({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadConfig: makeConfig,
    });
    const app = createOAuthRoutes(service);

    const authorizeRes = await app.request(
      "/oauth/google/authorize?agent=a1"
    );
    expect(authorizeRes.status).toBe(302);
    const location = authorizeRes.headers.get("location")!;
    const state = new URL(location).searchParams.get("state")!;
    expect(location).toContain("accounts.google.com");

    const callbackRes = await app.request(
      `/oauth/google/callback?code=code-1&state=${state}`
    );
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain("Connected");
    expect(html).toContain("alice@example.com");

    expect(store.get("a1", "google")?.accessToken).toBe("A1");
  });

  it("authorize requires an agent query param", async () => {
    const app = createOAuthRoutes(
      new OAuthService({ store, loadConfig: makeConfig })
    );
    const res = await app.request("/oauth/google/authorize");
    expect(res.status).toBe(400);
  });

  it("status reports connected after a saved connection", async () => {
    store.save({
      agentId: "a1",
      provider: "google",
      accessToken: "A1",
      account: "alice@example.com",
      scopes: [],
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const app = createOAuthRoutes(
      new OAuthService({ store, loadConfig: makeConfig })
    );
    const res = await app.request("/oauth/google/status?agent=a1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; account?: string };
    expect(body.connected).toBe(true);
    expect(body.account).toBe("alice@example.com");
  });

  it("callback surfaces a provider error page without throwing", async () => {
    const app = createOAuthRoutes(
      new OAuthService({ store, loadConfig: makeConfig })
    );
    const res = await app.request("/oauth/google/callback?error=access_denied");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("access_denied");
  });
});
