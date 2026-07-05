import { describe, expect, it } from "vitest";
import {
  buildAutoFormFields,
  splitAutoFormValues,
} from "./auto-form-schema";

describe("buildAutoFormFields", () => {
  it("returns no fields for a null/empty schema", () => {
    expect(buildAutoFormFields(null, [])).toEqual([]);
    expect(buildAutoFormFields({}, [])).toEqual([]);
    expect(buildAutoFormFields({ properties: {} }, [])).toEqual([]);
  });

  it("builds a masked secret field for a requiredSecrets property (exa tracer)", () => {
    const fields = buildAutoFormFields(
      {
        type: "object",
        properties: { apiKey: { type: "string" } },
        required: ["apiKey"],
      },
      ["apiKey"]
    );
    expect(fields).toEqual([
      {
        name: "apiKey",
        label: "apiKey",
        description: undefined,
        type: "secret",
        required: true,
        secret: true,
      },
    ]);
  });

  it("drops the base `enabled` toggle", () => {
    const fields = buildAutoFormFields(
      {
        properties: {
          enabled: { type: "boolean" },
          apiKey: { type: "string" },
        },
      },
      ["apiKey"]
    );
    expect(fields.map((f) => f.name)).toEqual(["apiKey"]);
  });

  it("maps schema types to field types and honors title/description", () => {
    const fields = buildAutoFormFields(
      {
        properties: {
          host: { type: "string", title: "Host", description: "The host URL" },
          port: { type: "integer" },
          verbose: { type: "boolean" },
        },
        required: ["host"],
      },
      []
    );
    expect(fields).toEqual([
      {
        name: "host",
        label: "Host",
        description: "The host URL",
        type: "text",
        required: true,
        secret: false,
      },
      {
        name: "port",
        label: "port",
        description: undefined,
        type: "number",
        required: false,
        secret: false,
      },
      {
        name: "verbose",
        label: "verbose",
        description: undefined,
        type: "boolean",
        required: false,
        secret: false,
      },
    ]);
  });

  it("treats a secret field as secret even when its schema type is not string", () => {
    const fields = buildAutoFormFields(
      { properties: { token: { type: "integer" } } },
      ["token"]
    );
    expect(fields[0].type).toBe("secret");
    expect(fields[0].secret).toBe(true);
    expect(fields[0].required).toBe(true);
  });
});

describe("splitAutoFormValues", () => {
  const fields = buildAutoFormFields(
    {
      properties: {
        apiKey: { type: "string" },
        host: { type: "string" },
        port: { type: "integer" },
        verbose: { type: "boolean" },
      },
    },
    ["apiKey"]
  );

  it("routes secrets to `secrets` and non-secrets to `config`", () => {
    const { config, secrets } = splitAutoFormValues(fields, {
      apiKey: "sk-123",
      host: "example.com",
      port: "8080",
      verbose: true,
    });
    expect(secrets).toEqual({ apiKey: "sk-123" });
    expect(config).toEqual({ host: "example.com", port: 8080, verbose: true });
  });

  it("omits blank text/number and empty secrets, keeps booleans", () => {
    const { config, secrets } = splitAutoFormValues(fields, {
      apiKey: "",
      host: "",
      port: "",
      verbose: false,
    });
    expect(secrets).toEqual({});
    expect(config).toEqual({ verbose: false });
  });

  it("drops non-numeric number input", () => {
    const { config } = splitAutoFormValues(fields, { port: "abc" });
    expect(config).not.toHaveProperty("port");
  });
});
