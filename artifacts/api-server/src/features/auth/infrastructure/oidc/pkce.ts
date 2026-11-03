import crypto from "node:crypto";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Generate a PKCE code_verifier and the matching S256 code_challenge. */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

/** Random opaque state value (CSRF protection on the redirect). */
export function makeState(): string {
  return base64url(crypto.randomBytes(24));
}
