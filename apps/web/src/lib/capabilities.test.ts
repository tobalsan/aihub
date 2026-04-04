import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capabilities,
  capabilitiesReady,
  loadCapabilities,
  resetCapabilitiesForTests,
} from "./capabilities";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

describe("capabilities store", () => {
  const fetchMock = vi.fn<() => Promise<FetchResponse>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resetCapabilitiesForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCapabilitiesForTests();
  });

  it("loads capabilities normally", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        version: 2,
        components: { projects: true },
        agents: ["main"],
        multiUser: false,
      }),
    });

    const result = await loadCapabilities();

    expect(result.multiUser).toBe(false);
    expect(capabilities.multiUser).toBe(false);
    expect(capabilitiesReady()).toBe(true);
  });

  it("treats 401 capabilities as multi-user boot state", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    });

    const result = await loadCapabilities();

    expect(result.multiUser).toBe(true);
    expect(capabilities.multiUser).toBe(true);
    expect(capabilitiesReady()).toBe(true);
  });
});
