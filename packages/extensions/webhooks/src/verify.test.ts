import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectKnownWebhookType,
  resolveSigningSecret,
  verifyWebhookSignature,
} from "./verify.js";

function sign(
  payload: string,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): string {
  return crypto.createHmac("sha256", secret).update(payload).digest(encoding);
}

describe("webhook signature verification", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  it("verifies GitHub sha256 signatures", () => {
    const payload = '{"action":"opened"}';
    const signature = `sha256=${sign(payload, "secret")}`;
    const headers = new Headers({ "x-hub-signature-256": signature });

    expect(
      verifyWebhookSignature({
        webhookName: "github",
        headers,
        payload,
        signingSecret: "secret",
      })
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        webhookName: "github",
        headers,
        payload,
        signingSecret: "wrong",
      })
    ).toBe(false);
  });

  it("verifies Notion hex signatures", () => {
    const payload = '{"page":"updated"}';
    const headers = new Headers({
      "x-notion-signature": sign(payload, "secret"),
    });

    expect(
      verifyWebhookSignature({
        webhookName: "notion",
        headers,
        payload,
        signingSecret: "secret",
      })
    ).toBe(true);
  });

  it("verifies Zendesk base64 signatures", () => {
    const payload = '{"ticket":123}';
    const headers = new Headers({
      "x-zendesk-webhook-signature": sign(payload, "secret", "base64"),
    });

    expect(
      verifyWebhookSignature({
        webhookName: "zendesk",
        headers,
        payload,
        signingSecret: "secret",
      })
    ).toBe(true);
  });

  it("resolves $env signing secrets", () => {
    process.env.WEBHOOK_SECRET = "from-env";

    expect(resolveSigningSecret("$env:WEBHOOK_SECRET")).toBe("from-env");
  });

  it("detects known types by header presence", () => {
    expect(
      detectKnownWebhookType(
        "custom",
        new Headers({ "x-hub-signature-256": "sha256=abc" })
      )
    ).toBe("github");
  });
});
