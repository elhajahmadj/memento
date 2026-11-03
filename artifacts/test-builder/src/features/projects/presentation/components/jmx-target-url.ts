// Accept bare hostnames (default `https://`) and already-absolute
// http(s) URLs; null for empty/garbage/non-http(s).
export function normalizeJmxTargetUrl(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const c = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(c);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
