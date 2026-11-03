/**
 * Fetch the IDP's end-session URL for the current session.
 *
 * Must be called *before* the local session is destroyed — once the
 * cookie is gone the server can no longer look up the `id_token_hint`
 * the identity provider needs. Local username/password users get `null` and the caller
 * falls through to the existing local-only sign-out.
 *
 * Non-fatal by design: any failure resolves to `null` so a flaky lookup
 * degrades to a local logout instead of trapping the user in a session
 * they asked to end.
 */
export async function fetchSsoEndSessionUrl(): Promise<string | null> {
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/auth/sso/end-session-url`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { endSessionUrl?: string | null };
    return body.endSessionUrl ?? null;
  } catch {
    return null;
  }
}
