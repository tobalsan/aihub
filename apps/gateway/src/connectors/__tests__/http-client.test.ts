import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  type CreateHttpClientOptions,
} from "../http-client.js";

const ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
] as const;
type FetchMock = (input: string | URL, init?: RequestInit) => Promise<Response>;

function makeClient(options: Partial<CreateHttpClientOptions> = {}) {
  return createHttpClient({
    connectorId: "demo",
    ...options,
  });
}

describe("createHttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("passes through plain fetch when onecli is disabled", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    await client.fetch("https://example.com");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
  });

  it("sets proxy env vars during fetch and restores them after", async () => {
    process.env.HTTP_PROXY = "http://previous-http";
    process.env.HTTPS_PROXY = "http://previous-https";

    const snapshots: Array<Record<string, string | undefined>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        snapshots.push({
          HTTP_PROXY: process.env.HTTP_PROXY,
          HTTPS_PROXY: process.env.HTTPS_PROXY,
        });
        return new Response("ok");
      })
    );

    const client = makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255",
      },
    });

    await client.fetch("https://example.com");

    expect(snapshots).toEqual([
      {
        HTTP_PROXY: "http://localhost:10255",
        HTTPS_PROXY: "http://localhost:10255",
      },
    ]);
    expect(process.env.HTTP_PROXY).toBe("http://previous-http");
    expect(process.env.HTTPS_PROXY).toBe("http://previous-https");
  });

  it("embeds the gateway token in the proxy url", async () => {
    let seenHttpProxy: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        seenHttpProxy = process.env.HTTP_PROXY;
        return new Response("ok");
      })
    );

    const client = makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255/",
        gatewayToken: "abc123",
      },
    });

    await client.fetch("https://example.com");

    expect(seenHttpProxy).toBe("http://onecli:abc123@localhost:10255");
  });

  it("sets CA env vars when a CA path is configured", async () => {
    const snapshots: Array<Record<string, string | undefined>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        snapshots.push({
          NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
          SSL_CERT_FILE: process.env.SSL_CERT_FILE,
          REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
        });
        return new Response("ok");
      })
    );

    const client = makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255",
        caPath: "/tmp/onecli-ca.pem",
      },
    });

    await client.fetch("https://example.com");

    expect(snapshots).toEqual([
      {
        NODE_EXTRA_CA_CERTS: "/tmp/onecli-ca.pem",
        SSL_CERT_FILE: "/tmp/onecli-ca.pem",
        REQUESTS_CA_BUNDLE: "/tmp/onecli-ca.pem",
      },
    ]);
    expect(process.env.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(process.env.SSL_CERT_FILE).toBeUndefined();
    expect(process.env.REQUESTS_CA_BUNDLE).toBeUndefined();
  });

  it("applies default headers and timeout", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient({
      headers: {
        "x-default": "default",
      },
      timeoutMs: 2500,
    });

    await client.fetch("https://example.com", {
      headers: {
        "x-request": "request",
      },
    });

    const init = fetchMock.mock.calls.at(0)?.[1];
    expect(init).toBeDefined();
    if (!init) {
      throw new Error("expected fetch init");
    }
    const headers = init.headers as Headers;

    expect(headers.get("x-default")).toBe("default");
    expect(headers.get("x-request")).toBe("request");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
