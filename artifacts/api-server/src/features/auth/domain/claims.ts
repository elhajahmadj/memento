import crypto from "node:crypto";

/**
 * Pure claim parsing for OIDC sign-in. No IO. Given a raw claim
 * payload (ID token + /userinfo merged) plus the IDP-specific claim
 * names, produce the normalized shape that the SSO callback and the
 * bearer middleware both consume.
 */

export type MementoRole =
  | "memento_admin"
  | "admin"
  | "limited_admin"
  | "limited"
  /**
   * Throwaway "Continue as guest" trial identity. Included here so
   * `EffectiveRole` (which aliases this type) can carry it for guest
   * requests, but it is **never IDP-assignable**: `mapRoleString`
   * returns null for it, so no claim value can ever produce a guest,
   * and it is excluded from {@link PerOrgRole} because guests have no
   * organizations.
   */
  | "guest";

export interface NormalizedClaims {
  /** Stable IDP user identifier; used as the local username. */
  subject: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Raw org keys reported by the IDP for this user. */
  orgKeys: string[];
  /**
   * Optional friendly display names for the orgs in `orgKeys`, keyed
   * by the same external key. Sourced from the IDP claim payload (e.g.
   * Nexus's `organizations[].org_name`) when available; missing entries
   * mean we have no friendly name and the upsert should fall back to
   * the external key.
   */
  orgDisplayNames: Record<string, string>;
  /**
   * Memento role derived from the IDP `roles` claim. Defaults to
   * `limited` (the User role) when the claim is missing or holds no
   * recognized value. Highest privilege wins.
   */
  role: MementoRole;
  /**
   * True iff the Nexus user-claim namespace carries the
   * configured user-gate claim (default `mementoUser`) as a truthy
   * value. When the namespace is absent we look for the same name at
   * the top level so non-Nexus IDPs can opt in.
   */
  hasMementoUserClaim: boolean;
  /**
   * True iff the user-claim source (Nexus namespace when present,
   * otherwise top-level) opens the god-mode gate. Two shapes are
   * accepted; either is sufficient:
   *   A. the boolean admin gate — the configured admin claim
   *      (default `mementoAdmin`) is truthy. This is the canonical
   *      Nexus shape (`mementoAdmin: true` alongside `mementoUser`).
   *   B. the legacy three-claim combo:
   *      1. the configured access claim (default `mementoAccess`) is
   *         truthy;
   *      2. the configured god-mode role claim (default
   *         `mementoGodMode`) equals the configured role value
   *         (default `mementoAdmin`);
   *      3. the configured god-mode tier claim (default
   *         `NexusTier reserved`) equals the configured tier value
   *         (default `NexusAdmin`).
   * String comparisons are case-sensitive. When this is true the
   * resolved role is promoted to `memento_admin` regardless of what
   * the IDP `roles` claim said; when it is false the role can never
   * be `memento_admin` (a Nexus-asserted Memento Admin role with the
   * gate closed is downgraded to `admin`).
   */
  isGodmode: boolean;
  /**
   * The set of org external keys (Nexus organization id / slug) whose
   * `organizations[]` entry carries the configured org-gate claim
   * (default `mementoAccess`) as a truthy value. Nexus emits the gate
   * flag inside each org entry alongside the org's id/name/roles, so
   * this set is built by walking the same array that feeds
   * {@link NormalizedClaims.orgKeys}. Empty when none of the user's
   * orgs grant memento access — or when no orgs were emitted at all.
   */
  mementoAccessOrgKeys: Set<string>;
  /**
   * Per-org memento role derived from the IDP claim payload. Keyed by
   * the same org external key used in {@link NormalizedClaims.orgKeys}.
   * The value is the highest-privilege memento role any of the org
   * entry's `roles[]` mapped to, or `null` when the entry carried no
   * recognized role string. Per-org roles never carry `memento_admin`
   * — the god-mode super role is org-independent and lives only on
   * `users.role`. Used by the provisioner to write a typed `role`
   * column on each `user_organizations` row.
   *
   * Empty when the IDP didn't emit role information per-org (e.g. a
   * top-level `roles` claim only); in that case the provisioner falls
   * back to the user-level role.
   */
  perOrgRoles: Map<string, PerOrgRole | null>;
  /**
   * Raw role string the IDP reported for the user within each org,
   * preserved verbatim for audit/debug. Same keying as
   * {@link NormalizedClaims.perOrgRoles}. May be null when no role
   * field was present on the entry.
   */
  perOrgIdpRoleRaw: Map<string, string | null>;
  /** True iff `claims[userClaimsNamespace]` was an object. */
  nexusNamespacePresent: boolean;
}

/**
 * Per-org role subset of {@link MementoRole}. `memento_admin` is
 * intentionally excluded: it's an org-independent super-role that
 * only ever lands on `users.role`. `guest` is excluded for the
 * opposite reason — guests never belong to an organization at all.
 */
export type PerOrgRole = Exclude<MementoRole, "memento_admin" | "guest">;

/**
 * Narrow a global role (`users.role`) down to something storable on a
 * `user_organizations` row, or null when it has no per-org meaning.
 *
 * Two roles have none: `memento_admin` is an org-independent super-role
 * that only ever lives on `users.role`, and `guest` is a throwaway trial
 * identity that never belongs to an organization at all. Callers decide
 * what null means for them — the provisioner falls back to `limited`,
 * the backfill falls through to its next source.
 */
export function toPerOrgRole(role: MementoRole): PerOrgRole | null {
  if (role === "memento_admin" || role === "guest") return null;
  return role;
}

/**
 * Optional knob bag for {@link normalizeClaims}. Defaults match a
 * fresh Nexus deployment (`https://nexus/claims`, `mementoUser`,
 * `mementoAccess`) so callers passing nothing get the right behavior
 * out of the box.
 */
export interface NormalizeClaimsOptions {
  userClaimsNamespace?: string;
  mementoUserClaim?: string;
  mementoAccessClaim?: string;
  /**
   * Name of the user-level access claim consulted as the **first**
   * leg of the god-mode triple. Defaults to `mementoAccess` — the
   * same name as the org-entry gate, but read from the user-claim
   * source (the Nexus namespace when present, top-level otherwise).
   */
  mementoGodModeAccessClaim?: string;
  /**
   * User-claim name carrying a boolean god-mode admin gate. When the
   * user-claim source (Nexus namespace when present, top-level
   * otherwise) carries this claim as truthy, the user is promoted to
   * `memento_admin` regardless of the triple. Defaults to
   * `mementoAdmin`. Case-sensitive.
   */
  mementoAdminClaim?: string;
  /** User-claim name carrying the god-mode role string. */
  mementoGodModeRoleClaim?: string;
  /** Exact string value the god-mode role claim must equal. */
  mementoGodModeRoleValue?: string;
  /** User-claim name carrying the god-mode tier string. */
  mementoGodModeTierClaim?: string;
  /** Exact string value the god-mode tier claim must equal. */
  mementoGodModeTierValue?: string;
}

const ROLE_PRIORITY: Record<MementoRole, number> = {
  memento_admin: 4,
  admin: 3,
  limited_admin: 2,
  limited: 1,
  // Lowest priority. Unreachable in practice — `pickBestRole` only ever
  // ranks values returned by `mapRoleString`, which never yields
  // `guest` — but keeping the map total over `MementoRole` means adding
  // a role can't silently produce an `any` index.
  guest: 0,
};

/**
 * Map a single Nexus role string to a memento role. Recognizes the
 * canonical Nexus role names — "Memento Admin", "Admin", "Limited
 * Admin", and "User" — case- and whitespace-insensitively. Returns
 * null for unknown values.
 */
export function mapRoleString(raw: unknown): MementoRole | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (v === "memento admin") return "memento_admin";
  if (v === "admin") return "admin";
  if (v === "limited admin") return "limited_admin";
  if (v === "user") return "limited";
  return null;
}

/**
 * Walk an array of unknown values and return the highest-privilege
 * memento role any of them maps to. Unknown values are ignored.
 * Returns null when nothing matched so callers can decide what to do
 * (default to `limited`, fall back to another source, etc.).
 */
function pickBestRole(values: unknown[]): MementoRole | null {
  let best: MementoRole | null = null;
  for (const v of values) {
    const mapped = mapRoleString(v);
    if (!mapped) continue;
    if (!best || ROLE_PRIORITY[mapped] > ROLE_PRIORITY[best]) {
      best = mapped;
    }
  }
  return best;
}

/**
 * Pick the highest-privilege memento role across every value in the
 * IDP `roles` claim. Unknown values are ignored. When the claim is
 * empty / missing / has no recognized values, falls back to `limited`
 * (the User role) so a user with no explicit role still gets
 * least-privilege access.
 */
export function pickRoleFromClaims(
  claims: Record<string, unknown>,
  rolesClaim: string,
): MementoRole {
  const raw = claims[rolesClaim];
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  return pickBestRole(arr) ?? "limited";
}

/**
 * Some IDPs (Nexus) nest the user's role *inside* each
 * `organizations[]` entry — e.g. `organizations: [{ id, name, slug,
 * roles: ["Admin"] }]` — instead of emitting a top-level `roles`
 * claim. This helper walks the org array and collects every
 * role-string it finds. It accepts:
 *   - a `roles: string[]` field on each org entry
 *   - a `roles: { name|displayName|display_name|role }[]` array of
 *     objects on each org entry
 *   - a `role: string` singular field on each org entry
 *
 * Returns an empty array when the input isn't an array or when no
 * role-shaped values are found.
 */
function collectRolesFromOrgEntries(orgArr: unknown): unknown[] {
  if (!Array.isArray(orgArr)) return [];
  const collected: unknown[] = [];
  for (const entry of orgArr) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const rolesField = obj["roles"];
    if (Array.isArray(rolesField)) {
      for (const item of rolesField) {
        if (typeof item === "string") {
          collected.push(item);
        } else if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          for (const k of [
            "name",
            "displayName",
            "display_name",
            "role",
          ] as const) {
            const v = itemObj[k];
            if (typeof v === "string") {
              collected.push(v);
              break;
            }
          }
        }
      }
    } else if (typeof rolesField === "string") {
      collected.push(rolesField);
    }
    const singular = obj["role"];
    if (typeof singular === "string") collected.push(singular);
  }
  return collected;
}

function pickString(
  claims: Record<string, unknown>,
  ...names: string[]
): string | null {
  for (const n of names) {
    const v = claims[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Pull a string field out of a claim entry that may itself be an
 * object, trying a list of likely property names in priority order.
 * Returns the first non-empty string match, or null if none of the
 * names hold a usable value.
 */
function pickFromObject(
  obj: Record<string, unknown>,
  ...names: string[]
): string | null {
  for (const n of names) {
    const v = obj[n];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Extract the org membership list from an OIDC claim payload.
 *
 * Supports three shapes seen in the wild:
 *  - Single string: `"acme"` → one org with key `"acme"`.
 *  - Array of strings: `["acme", "globex"]` → two orgs.
 *  - Array of objects (e.g. Nexus's `organizations` claim, which
 *    carries `{ org_id, org_name, org_slug }` per entry): the key is
 *    pulled from the first present of `id | org_id | slug | org_slug
 *    | externalKey | key`, and a friendly display name is captured
 *    from `name | org_name | display_name | displayName | slug |
 *    org_slug` when available.
 *
 * Anything that doesn't yield a usable key is skipped silently — a
 * malformed entry must not abort the sign-in.
 */
function extractOrgs(
  raw: unknown,
  mementoAccessClaim: string,
): {
  keys: string[];
  displayNames: Record<string, string>;
  mementoAccessKeys: string[];
  perOrgRoles: Map<string, PerOrgRole | null>;
  perOrgIdpRoleRaw: Map<string, string | null>;
} {
  const keys: string[] = [];
  const displayNames: Record<string, string> = {};
  const mementoAccessKeys: string[] = [];
  const perOrgRoles = new Map<string, PerOrgRole | null>();
  const perOrgIdpRoleRaw = new Map<string, string | null>();
  const push = (
    key: string | null,
    name: string | null,
    grantsAccess: boolean,
    role: PerOrgRole | null,
    rawRole: string | null,
  ) => {
    if (!key) return;
    keys.push(key);
    if (name && !displayNames[key]) displayNames[key] = name;
    if (grantsAccess) mementoAccessKeys.push(key);
    if (!perOrgRoles.has(key)) perOrgRoles.set(key, role);
    if (!perOrgIdpRoleRaw.has(key)) perOrgIdpRoleRaw.set(key, rawRole);
  };
  if (typeof raw === "string" && raw.trim().length > 0) {
    push(raw.trim(), null, false, null, null);
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        push(entry.trim() || null, null, false, null, null);
      } else if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const key = pickFromObject(
          obj,
          "id",
          "org_id",
          "organizationId",
          "slug",
          "org_slug",
          "externalKey",
          "external_key",
          "key",
        );
        const name = pickFromObject(
          obj,
          "name",
          "org_name",
          "display_name",
          "displayName",
          "slug",
          "org_slug",
        );
        // Per-org gate (Nexus shape): each `organizations[]` entry
        // carries `mementoAccess: true` alongside id/name/roles. The
        // claim-name comparison is case-sensitive (mirrors the
        // user-gate behavior).
        const grantsAccess = Boolean(obj[mementoAccessClaim]);
        // Per-org role: highest-privilege memento role mapped from any
        // role string inside this org entry. Excludes `memento_admin`
        // (god-mode is org-independent and never recorded per-org).
        const orgRoleStrings = collectRolesFromOrgEntries([entry]);
        const bestOrgRole = pickBestRole(orgRoleStrings);
        const perOrgRole: PerOrgRole | null =
          bestOrgRole && bestOrgRole !== "memento_admin"
            ? (bestOrgRole as PerOrgRole)
            : null;
        const rawRoleString =
          orgRoleStrings.find((v): v is string => typeof v === "string") ??
          null;
        push(key, name, grantsAccess, perOrgRole, rawRoleString);
      }
    }
  }
  return {
    keys,
    displayNames,
    mementoAccessKeys,
    perOrgRoles,
    perOrgIdpRoleRaw,
  };
}

export function normalizeClaims(
  claims: Record<string, unknown>,
  orgClaimName: string,
  rolesClaimName: string = "roles",
  options: NormalizeClaimsOptions = {},
): NormalizedClaims {
  const userClaimsNamespace =
    options.userClaimsNamespace ?? "https://nexus/claims";
  const mementoUserClaim = options.mementoUserClaim ?? "mementoUser";
  const mementoAccessClaim = options.mementoAccessClaim ?? "mementoAccess";
  const mementoGodModeAccessClaim =
    options.mementoGodModeAccessClaim ?? "mementoAccess";
  const mementoAdminClaim = options.mementoAdminClaim ?? "mementoAdmin";
  const mementoGodModeRoleClaim =
    options.mementoGodModeRoleClaim ?? "mementoGodMode";
  const mementoGodModeRoleValue =
    options.mementoGodModeRoleValue ?? "mementoAdmin";
  const mementoGodModeTierClaim =
    options.mementoGodModeTierClaim ?? "NexusTier reserved";
  const mementoGodModeTierValue =
    options.mementoGodModeTierValue ?? "NexusAdmin";

  // Nexus emits **user** custom claims in a namespaced object at
  // `claims["https://nexus/claims"]`. When that namespace is present
  // we prefer reading the user-gate flag and the role assignment from
  // inside it; the legacy top-level / org-nested behavior is kept as a
  // safety net so non-Nexus IDPs (and the existing test fixtures) keep
  // working unchanged.
  const nsRaw = claims[userClaimsNamespace];
  const ns =
    nsRaw && typeof nsRaw === "object" && !Array.isArray(nsRaw)
      ? (nsRaw as Record<string, unknown>)
      : null;
  const nexusNamespacePresent = ns !== null;

  // Try the configured claim name first; fall back to Nexus's standard
  // `organizations` claim when the configured one is absent. This lets
  // a fresh deployment work against Nexus without anyone having to set
  // `OIDC_ORG_CLAIM=organizations` by hand.
  let raw = claims[orgClaimName];
  if (raw === undefined && orgClaimName !== "organizations") {
    raw = claims["organizations"];
  }
  const {
    keys,
    displayNames,
    mementoAccessKeys,
    perOrgRoles,
    perOrgIdpRoleRaw,
  } = extractOrgs(raw, mementoAccessClaim);

  const subject =
    pickString(claims, "sub", "preferred_username", "email") ??
    `oidc-${crypto.randomBytes(8).toString("hex")}`;

  // User-gate flag. When the Nexus namespace is present we read the
  // case-sensitive `mementoUser` key from inside it; otherwise we
  // accept it at the top level so a non-Nexus IDP can opt in by
  // emitting `mementoUser:true` directly.
  const userClaimSource = ns ?? claims;
  const hasMementoUserClaim = Boolean(userClaimSource[mementoUserClaim]);
  // God-mode triple. The `memento_admin` super role is granted only
  // when **all three** claims are present (and matching) inside the
  // user-claim source: the access flag is truthy, the god-mode role
  // string equals the configured value, and the tier string equals
  // the configured value. String comparisons are case-sensitive.
  // No combination of IDP-asserted roles can promote a user to
  // memento_admin without this triple.
  const isGodmode =
    Boolean(userClaimSource[mementoAdminClaim]) ||
    (Boolean(userClaimSource[mementoGodModeAccessClaim]) &&
      userClaimSource[mementoGodModeRoleClaim] === mementoGodModeRoleValue &&
      userClaimSource[mementoGodModeTierClaim] === mementoGodModeTierValue);

  // Role resolution: when the Nexus namespace is present, the role
  // string lives at `ns[rolesClaim]`. Otherwise prefer the top-level
  // `roles` claim whenever it contains a recognized value (Admin,
  // Limited Admin, or User) — even an explicit `User` wins over nested
  // org roles, so an IDP that intentionally downgrades a global admin
  // to User cannot be bypassed by a stale per-org `Admin` membership.
  //
  // Only when neither path yields a recognized value do we fall back
  // to roles nested inside each `organizations[]` entry. Across
  // multiple orgs, highest privilege wins.
  const rawRoles = ns ? ns[rolesClaimName] : claims[rolesClaimName];
  const rolesArr: unknown[] = Array.isArray(rawRoles)
    ? rawRoles
    : typeof rawRoles === "string"
      ? [rawRoles]
      : [];
  const bestFromRoles = pickBestRole(rolesArr);
  const resolvedRole: MementoRole =
    bestFromRoles ?? pickBestRole(collectRolesFromOrgEntries(raw)) ?? "limited";
  // Apply the god-mode gate. `memento_admin` is granted iff the
  // three-claim combo matches (independent of the IDP `roles` claim);
  // when the combo doesn't match, a Nexus-asserted Memento Admin
  // role is downgraded to plain `admin` so role-assignment alone can
  // never grant god-mode. All other roles pass through.
  const role: MementoRole = isGodmode
    ? "memento_admin"
    : resolvedRole === "memento_admin"
      ? "admin"
      : resolvedRole;

  // Org-gate set. Nexus emits the org-gate flag inside each
  // `organizations[]` entry alongside `id`/`name`/`roles`. We collect
  // the external key of every entry whose configured access claim is
  // truthy and let the use case filter `orgKeys` through this set.
  const mementoAccessOrgKeys = new Set<string>(mementoAccessKeys);

  return {
    subject,
    email: pickString(claims, "email"),
    firstName: pickString(claims, "given_name", "first_name"),
    lastName: pickString(claims, "family_name", "last_name"),
    orgKeys: Array.from(new Set(keys)),
    orgDisplayNames: displayNames,
    role,
    hasMementoUserClaim,
    isGodmode,
    mementoAccessOrgKeys,
    perOrgRoles,
    perOrgIdpRoleRaw,
    nexusNamespacePresent,
  };
}
