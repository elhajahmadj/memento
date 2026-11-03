/**
 * Derive a stable PascalCase identifier ending in `BaseUrl` from a
 * navigate URL. Used so every emitter (C#, Python, Node.js, Java)
 * agrees on the name of the URL constant that lands in their
 * configuration file (appsettings.json, config.py, tests/config.ts,
 * application.properties).
 *
 * Examples:
 *   https://www.google.com/         → GoogleBaseUrl
 *   yahoo.com                       → YahooBaseUrl
 *   https://app.foo-bar.io/login    → FooBarBaseUrl
 *   http://192.168.1.10:8080        → BaseUrl   (IP — fall back)
 *   http://localhost:3000           → BaseUrl   (localhost — fall back)
 */
export function deriveUrlName(rawUrl: string): string {
  const fallback = "BaseUrl";
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return fallback;

  let host = "";
  try {
    const u = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    host = u.hostname;
  } catch {
    return fallback;
  }
  if (!host) return fallback;

  // localhost / IPv4 / IPv6 — fall back.
  if (host === "localhost") return fallback;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return fallback;
  if (host.includes(":")) return fallback; // IPv6

  // Strip leading "www." then split on dots.
  const stripped = host.replace(/^www\./i, "");
  const parts = stripped.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) return fallback;

  // Common public suffixes we don't want to use as the name. This is
  // intentionally a small heuristic — not a full PSL — picking the
  // longest non-suffix segment is good enough for naming.
  const PUBLIC_SUFFIXES = new Set([
    "com", "net", "org", "io", "co", "dev", "app", "ai", "edu", "gov",
    "us", "uk", "ca", "de", "fr", "es", "it", "jp", "cn", "in", "au",
    "nz", "br", "mx", "info", "biz", "me", "tv", "fm",
  ]);

  // Drop trailing public-suffix segments (handles e.g. .co.uk).
  let segments = [...parts];
  while (
    segments.length > 1 &&
    PUBLIC_SUFFIXES.has(segments[segments.length - 1]!.toLowerCase())
  ) {
    segments.pop();
  }
  if (segments.length === 0) segments = parts;

  // Pick the longest remaining segment as the brand.
  const brand = segments.reduce((a, b) => (b.length > a.length ? b : a), "");
  if (!brand) return fallback;

  return `${pascal(brand)}BaseUrl`;
}

function pascal(s: string): string {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}
