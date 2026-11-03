import {
  REACHABILITY_TIMEOUT_MS,
} from "../domain/validationStep";
import type { ReachabilityProbe } from "../application/ports";

/**
 * HEAD the start URL, fall back to GET if the server doesn't support
 * HEAD. Short timeout so an unreachable host fails fast.
 */
export function createFetchReachabilityProbe(): ReachabilityProbe {
  return {
    async probe(startUrl) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REACHABILITY_TIMEOUT_MS);
      try {
        let res: Response;
        try {
          res = await fetch(startUrl, { method: "HEAD", signal: ctrl.signal });
        } catch {
          res = await fetch(startUrl, { method: "GET", signal: ctrl.signal });
        }
        return {
          ok: res.ok || (res.status >= 200 && res.status < 500),
          status: res.status,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
