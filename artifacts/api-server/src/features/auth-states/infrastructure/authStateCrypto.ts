import { z } from "zod/v4";
import { decryptSecret, encryptSecret } from "@/shared/crypto";
import { logger } from "@/shared/logger";

/**
 * At-rest encryption for captured Playwright `storageState()` payloads
 * (audit finding H-2).
 *
 * The payload is the live session cookies and localStorage of the
 * application under test — a directly replayable credential for a
 * third-party, often production, system. It was the only secret class in
 * this codebase stored as plaintext; project git PATs, repo PATs, AI
 * provider keys and fork secrets all already go through
 * `shared/crypto.ts` (AES-256-GCM keyed from `PROJECT_SECRETS_KEY`).
 *
 * Storage format. The `auth_states.state` column stays `jsonb`, so this
 * needs no migration — deployment runs no migration step today. Instead
 * the ciphertext is wrapped in a one-key envelope:
 *
 *   { "enc": "v1:<iv_hex>:<tag_hex>:<ciphertext_hex>" }
 *
 * Rows written before this change are bare storageState objects with no
 * `enc` key. `unwrapState` returns those as-is, so existing captures
 * keep working and are re-encrypted transparently the next time the user
 * re-captures. That is deliberate: silently failing to load a saved
 * login would look like a product bug, and the plaintext row is no worse
 * off than it was before.
 */

/** Envelope key. Chosen to be short and unmistakable in a jsonb dump. */
const ENVELOPE_KEY = "enc";

interface Envelope {
  [ENVELOPE_KEY]: string;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[ENVELOPE_KEY] === "string"
  );
}

/**
 * Shape of a Playwright `storageState()` payload (audit finding M-8).
 *
 * `saveAuthState` previously stored `args.state` verbatim with an
 * explicit "we do not validate the shape here" comment — the only write
 * path in the codebase that accepted arbitrary client-controlled
 * structure. `.loose()` on each object keeps forward compatibility
 * with fields Playwright may add, while still pinning the envelope so a
 * wholly unrelated object is rejected at the boundary rather than
 * discovered at replay time.
 */
export const StorageStateSchema = z
  .object({
    cookies: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.string(),
            domain: z.string().optional(),
            path: z.string().optional(),
          })
          .loose(),
      )
      .max(2_000)
      .optional(),
    origins: z
      .array(
        z
          .object({
            origin: z.string(),
            localStorage: z
              .array(z.object({ name: z.string(), value: z.string() }).loose())
              .max(5_000)
              .optional(),
          })
          .loose(),
      )
      .max(500)
      .optional(),
  })
  .loose();

export type StorageState = z.infer<typeof StorageStateSchema>;

/**
 * Validate a client-supplied storageState. Returns null when it does not
 * look like a Playwright payload at all, so callers can reject with a
 * 400 rather than storing something that will fail opaquely at replay.
 */
export function parseStorageState(state: unknown): StorageState | null {
  const parsed = StorageStateSchema.safeParse(state);
  return parsed.success ? parsed.data : null;
}

/** Encrypt a storageState payload for storage in the jsonb column. */
export function wrapState(state: unknown): Envelope {
  return { [ENVELOPE_KEY]: encryptSecret(JSON.stringify(state ?? null)) };
}

/**
 * Decrypt a stored payload back to the storageState object.
 *
 * Returns `null` when the value cannot be recovered — a wrong or missing
 * `PROJECT_SECRETS_KEY`, or a corrupt envelope. Callers treat `null` as
 * "no saved login", which degrades to a normal un-authenticated
 * recording rather than failing the request.
 */
export function unwrapState(stored: unknown): object | null {
  if (stored === null || stored === undefined) return null;

  // Legacy plaintext row, written before H-2. Pass through.
  if (!isEnvelope(stored)) {
    return stored as object;
  }

  try {
    const parsed = JSON.parse(decryptSecret(stored[ENVELOPE_KEY])) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as object;
  } catch (err) {
    logger.error(
      { err },
      "Could not decrypt a saved auth state — treating it as absent. " +
        "This usually means PROJECT_SECRETS_KEY changed since it was captured.",
    );
    return null;
  }
}

/** True when a stored value is an encrypted envelope rather than plaintext. */
export function isEncryptedState(stored: unknown): boolean {
  return isEnvelope(stored);
}
