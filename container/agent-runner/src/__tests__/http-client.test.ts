import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function loadHttpClient(): Promise<HttpClientModule> {
  return import("../http-client.js");
}

describe("createContainerHttpClient", () => {
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

  it("uses plain fetch without onecli config", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createContainerHttpClient } = await loadHttpClient();
    const client = createContainerHttpClient();
    await client.fetch("https://example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com", {});
    expect(proxyAgentMock).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("uses the OneCLI ProxyAgent for fetch requests", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { createContainerHttpClient } = await loadHttpClient();
    const client = createContainerHttpClient({
      enabled: true,
      url: "http://onecli:4141/",
    });
    await client.fetch("https://example.com", { method: "POST" });

    expect(proxyAgentMock).toHaveBeenCalledWith({
      uri: "http://onecli:4141",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "POST",
        dispatcher: expect.objectContaining({
          kind: "proxy-agent",
          options: { uri: "http://onecli:4141" },
        }),
      })
    );
  });

  it("loads the mounted CA cert for the proxy", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("CA_CERT");
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchMock>(async () => new Response("ok"))
    );

    const { createContainerHttpClient } = await loadHttpClient();
    const client = createContainerHttpClient({
      enabled: true,
      url: "http://onecli:4141",
      caPath: "/usr/local/share/ca-certificates/onecli-ca.pem",
    });
    await client.fetch("https://example.com");

    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/usr/local/share/ca-certificates/onecli-ca.pem",
      "utf8"
    );
    expect(proxyAgentMock).toHaveBeenCalledWith({
      uri: "http://onecli:4141",
      requestTls: { ca: "CA_CERT" },
    });
  });
});
