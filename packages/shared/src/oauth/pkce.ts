import { createHash, randomBytes } from "node:crypto";

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** Generate a PKCE verifier/challenge pair (RFC 7636, S256). */
export function generatePkce(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** Generate an opaque anti-CSRF state token. */
export function generateState(): string {
  return base64Url(randomBytes(24));
}
