import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const proxyAgentMock = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn(),
    },
    readFileSync: vi.fn(),
  };
});

vi.mock("undici", () => ({
  ProxyAgent: proxyAgentMock,
}));

type FetchMock = (input: string | URL, init?: RequestInit) => Promise<Response>;

type HttpClientModule = typeof import("../http-client.js");
type CreateHttpClientOptions =
  import("../http-client.js").CreateHttpClientOptions;

async function loadHttpClient(): Promise<HttpClientModule> {
  return import("../http-client.js");
}

async function makeClient(
  options: Partial<CreateHttpClientOptions> = {}
) {
  const { createHttpClient } = await loadHttpClient();
  return createHttpClient({
    connectorId: "demo",
    ...options,
  });
}

describe("createHttpClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    proxyAgentMock.mockImplementation((options) => ({
      kind: "proxy-agent",
      options,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes through plain fetch when onecli is disabled", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = await makeClient();
    await client.fetch("https://example.com");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    expect(proxyAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(fs.readFileSync)).not.toHaveBeenCalled();
  });

  it("creates a ProxyAgent with the gateway url and passes it to fetch", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = await makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255",
      },
    });

    await client.fetch("https://example.com");

    expect(proxyAgentMock).toHaveBeenCalledOnce();
    expect(proxyAgentMock).toHaveBeenCalledWith({
      uri: "http://localhost:10255",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        dispatcher: expect.objectContaining({
          kind: "proxy-agent",
          options: {
            uri: "http://localhost:10255",
          },
        }),
      })
    );
  });

  it("embeds the gateway token in the proxy url", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => new Response("ok")));

    const client = await makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255/",
        gatewayToken: "abc123",
      },
    });

    await client.fetch("https://example.com");

    expect(proxyAgentMock).toHaveBeenCalledWith({
      uri: "http://onecli:abc123@localhost:10255",
    });
  });

  it("loads the CA cert and passes it as requestTls", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("CA_CERT");
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => new Response("ok")));

    const client = await makeClient({
      onecli: {
        enabled: true,
        gatewayUrl: "http://localhost:10255",
        caPath: "/tmp/onecli-ca.pem",
      },
    });

    await client.fetch("https://example.com");

    expect(fs.readFileSync).toHaveBeenCalledWith("/tmp/onecli-ca.pem", "utf8");
    expect(proxyAgentMock).toHaveBeenCalledWith({
      uri: "http://localhost:10255",
      requestTls: {
        ca: "CA_CERT",
      },
    });
  });

  it("applies default headers and timeout", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = await makeClient({
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
