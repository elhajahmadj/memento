import crypto from "node:crypto";

/**
 * Symmetric encryption helper for per-project secrets (today: Azure
 * Repos PATs). Format: `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>` using
 * AES-256-GCM. The encryption key is derived from
 * `PROJECT_SECRETS_KEY` via SHA-256 so any reasonably-long passphrase
 * is acceptable.
 *
 * `getProjectSecretsKey()` is exported so callers can fail fast at
 * boot when ciphertext exists in the DB but the env var is missing.
 */
const KEY_ENV = "PROJECT_SECRETS_KEY";

export class ProjectSecretsKeyMissingError extends Error {
  constructor() {
    super(
      `${KEY_ENV} is not set. Set it to any reasonably-long random string so encrypted project secrets (e.g. Azure Repos PATs) can be read.`,
    );
    this.name = "ProjectSecretsKeyMissingError";
  }
}

export function getProjectSecretsKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length === 0) {
    throw new ProjectSecretsKeyMissingError();
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getProjectSecretsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Encrypted secret has unexpected format");
  }
  const key = getProjectSecretsKey();
  const iv = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const ct = Buffer.from(parts[3]!, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
