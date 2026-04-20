import crypto from "node:crypto";

export type KnownWebhookType = "github" | "notion" | "zendesk";

const KNOWN_HEADER_BY_TYPE: Record<KnownWebhookType, string> = {
  github: "x-hub-signature-256",
  notion: "x-notion-signature",
  zendesk: "x-zendesk-webhook-signature",
};

export function resolveSigningSecret(value: string): string | undefined {
  if (!value.startsWith("$env:")) return value;
  return process.env[value.slice("$env:".length)];
}

export function detectKnownWebhookType(
  webhookName: string,
  headers: Headers
): KnownWebhookType | undefined {
  const name = webhookName.toLowerCase();
  if (name.includes("github")) return "github";
  if (name.includes("notion")) return "notion";
  if (name.includes("zendesk")) return "zendesk";

  if (headers.has(KNOWN_HEADER_BY_TYPE.github)) return "github";
  if (headers.has(KNOWN_HEADER_BY_TYPE.notion)) return "notion";
  if (headers.has(KNOWN_HEADER_BY_TYPE.zendesk)) return "zendesk";
  return undefined;
}

export function verifyWebhookSignature(params: {
  webhookName: string;
  headers: Headers;
  payload: string;
  signingSecret: string;
}): boolean {
  const type = detectKnownWebhookType(params.webhookName, params.headers);
  if (!type) return true;

  const secret = resolveSigningSecret(params.signingSecret);
  if (!secret) return false;

  const signature = params.headers.get(KNOWN_HEADER_BY_TYPE[type])?.trim();
  if (!signature) return false;

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(params.payload)
    .digest(type === "zendesk" ? "base64" : "hex");

  const expected = type === "github" ? `sha256=${hmac}` : hmac;
  return timingSafeStringEqual(signature, expected);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return (
    aBuffer.length === bBuffer.length &&
    crypto.timingSafeEqual(aBuffer, bBuffer)
  );
}
