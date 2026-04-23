import { afterEach, describe, expect, it } from "vitest";
import { resolveLangfuseEnvironment } from "./index.js";

describe("resolveLangfuseEnvironment", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers explicit environment config", () => {
    process.env.LANGFUSE_ENV = "from-env";

    expect(
      resolveLangfuseEnvironment({
        environment: "from-config",
        env: "from-alias",
      })
    ).toBe("from-config");
  });

  it("supports legacy config env alias", () => {
    process.env.LANGFUSE_ENV = "from-env";

    expect(resolveLangfuseEnvironment({ env: "from-alias" })).toBe(
      "from-alias"
    );
  });

  it("falls back to LANGFUSE_ENV before defaulting to dev", () => {
    process.env.LANGFUSE_ENV = "test";

    expect(resolveLangfuseEnvironment({})).toBe("test");
  });

  it("defaults to dev when nothing else is set", () => {
    delete process.env.LANGFUSE_ENV;
    delete process.env.LANGFUSE_TRACING_ENVIRONMENT;
    delete process.env.LANGFUSE_ENVIRONMENT;

    expect(resolveLangfuseEnvironment({})).toBe("dev");
  });
});
