/**
 * Validate / normalize an inbound `login_hint` query parameter before
 * we forward it to the OIDC IDP. The value is treated as PII and a
 * potential injection vector — anything that doesn't look like a real
 * email is dropped silently so the IDP just sees an empty field.
 *
 * Rules (per the Nexus integration spec):
 *  - Must be a string.
 *  - Trim leading/trailing whitespace, lowercase.
 *  - Cap at 254 characters (RFC 5321 limit on a full email address).
 *  - Basic email shape: non-empty local part, single `@`, domain that
 *    contains at least one `.`, and no internal whitespace.
 *
 * Returns the normalized email when it passes every check, or
 * `undefined` when it should be omitted from the redirect URL.
 */
export function normalizeLoginHint(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 254) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  const at = trimmed.indexOf("@");
  if (at <= 0) return undefined;
  if (at !== trimmed.lastIndexOf("@")) return undefined;
  const domain = trimmed.slice(at + 1);
  if (domain.length === 0) return undefined;
  if (!domain.includes(".")) return undefined;
  // Reject leading/trailing dot in domain ("a@.com", "a@b.").
  if (domain.startsWith(".") || domain.endsWith(".")) return undefined;
  return trimmed;
}

/**
 * Extract just the domain portion of a normalized email so it can be
 * logged for diagnostics without leaking the local part (which is the
 * PII-sensitive piece). Caller must pass an already-normalized hint.
 */
export function loginHintDomain(normalized: string): string {
  const at = normalized.indexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : "";
}
