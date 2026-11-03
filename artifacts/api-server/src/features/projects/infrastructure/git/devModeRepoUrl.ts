import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";

/**
 * In dev/local environments only, accept `file://` repo URLs so the
 * UX-test suite can back the Settings → Git Repos UI with a local
 * bare git remote (no real Azure/GitHub creds required). Production
 * deployments (`APP_ENVIRONMENT` unset or anything else) keep the
 * strict HTTPS-only validation.
 */
export function isAllowedTestModeRepoUrl(raw: string): boolean {
  if (!isDevEnvironment()) return false;
  try {
    const u = new URL(raw);
    if (u.protocol === "file:") return true;
    // Loopback HTTP for the UX-test "auth_failed" fixture (a small C#
    // HttpListener that always returns 401). Only loopback hosts are
    // accepted; this never opens dev mode to arbitrary http URLs.
    if (u.protocol === "http:") {
      const host = u.hostname.toLowerCase();
      return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
    }
    return false;
  } catch {
    return false;
  }
}
