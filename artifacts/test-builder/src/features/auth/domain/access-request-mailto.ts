export interface AdminContact {
  email: string;
  displayName: string;
}

export interface AdminContactsPayload {
  org: { externalKey: string; displayName: string } | null;
  admins: AdminContact[];
}

/**
 * Best-effort message used as the body of the "Request access" mailto
 * link on the SSO deny banner. Kept generic — the user can edit before
 * sending.
 *
 * Pure, so it lives in `domain/` alongside the other no-I/O auth
 * helpers rather than in the login page component.
 */
export function buildAccessRequestMailto(
  contacts: AdminContact[],
  ssoError: string,
  orgDisplayName: string | null,
): string {
  const to = contacts.map((c) => c.email).join(",");
  const subject = encodeURIComponent("Request access to memento");
  const reason =
    ssoError === "no_memento_user"
      ? "I tried to sign in to memento but my account isn't authorized to use it yet."
      : ssoError === "no_memento_access"
        ? `I tried to sign in to memento but ${orgDisplayName ? `our organization (${orgDisplayName})` : "our organization"} isn't authorized to use it yet.`
        : "I tried to sign in to memento but was denied access.";
  const body = encodeURIComponent(
    `${reason}\n\nCould you please grant me access? Thank you.`,
  );
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
