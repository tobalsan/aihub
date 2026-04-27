import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  ApiClient: vi.fn(),
}));

import { ApiClient } from "./client.js";
import { program } from "./index.js";

describe("aihub projects status command", () => {
  const apiClientMock = vi.mocked(ApiClient);
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiClientMock.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists existing session slugs", async () => {
    const listProjectSubagents = vi.fn(async () => ({
      items: [{ slug: "coordinator" }, { slug: "worker-1" }, { slug: " " }],
    }));
    const getProject = vi.fn();
    apiClientMock.mockImplementation(
      () =>
        ({
          listProjectSubagents,
          getProject,
        }) as unknown as InstanceType<typeof ApiClient>
    );

    await program.parseAsync(["status", "PRO-1", "--list"], { from: "user" });

    expect(listProjectSubagents).toHaveBeenCalledWith("PRO-1", {
      includeArchived: true,
    });
    expect(getProject).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("coordinator\nworker-1");
  });
});
