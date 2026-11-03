/**
 * JMX project scaffolder.
 *
 * A JMX project has no compiled-language source tree — it is a
 * per-project workspace folder used by the CDP recorder to capture
 * HTTP traffic and by the XML emitter to materialize a JMeter `.jmx`
 * plan. Scaffolding therefore only creates:
 *
 *   - the project root directory under the workspace
 *   - an empty `.jmxproject` sentinel file (so project discovery can
 *     identify the folder as JMX without parsing the marker)
 *
 * The `.testbuilder.json` marker (containing `language: "jmx"`,
 * `targetUrl`, `jwtAuth`, and the initial empty `jmxFiles: []`) is
 * written by the caller via `ProjectRepository.writeMarker` so that
 * marker persistence stays in one place across every language.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  JMX_PROJECT_FILE,
} from "@/features/projects/domain/paths";
import type { Project } from "@/features/projects/domain/types";

export interface JmxScaffoldResult {
  rootPath: string;
  slnPath: string;
  testProjectName: string;
}

/**
 * Create the on-disk skeleton for a JMX project. Returns the bits the
 * caller needs to assemble a `Project` and write the marker. Does not
 * write `.testbuilder.json` — that is the caller's responsibility so
 * marker shape stays consistent with every other language.
 */
/**
 * Normalize a user-typed JMX Target URL into an absolute `http(s)://`
 * URL. Accepts bare hostnames (`www.google.com`) and defaults the
 * scheme to `https://`. Returns `null` for empty/garbage input or
 * non-http(s) schemes.
 */
export function normalizeJmxTargetUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  // When the user didn't type a scheme, only treat the input as a bare
  // hostname if it actually looks like one — i.e. contains a `.`, a `:`
  // (port), or is exactly `localhost`. This keeps `www.google.com` and
  // `localhost:3000` working while rejecting garbage like `not-a-url`.
  if (!hasScheme) {
    const hostPart = trimmed.split("/")[0] ?? "";
    const looksLikeHost =
      hostPart.includes(".") ||
      hostPart.includes(":") ||
      hostPart === "localhost";
    if (!looksLikeHost) return null;
  }
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    // Canonical form: bare-origin URLs (no path/query/hash) are returned
    // without the trailing slash that `URL.toString()` appends, so marker
    // `targetUrl` matches what the user typed (e.g. `https://b.test`).
    const s = u.toString();
    if (u.pathname === "/" && u.search === "" && u.hash === "") {
      return s.endsWith("/") ? s.slice(0, -1) : s;
    }
    return s;
  } catch {
    return null;
  }
}

export async function createJmxScaffold(
  solutionName: string,
  _namespace: string,
): Promise<Project> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const slnPath = path.join(rootPath, JMX_PROJECT_FILE);
  await fs.writeFile(slnPath, "");

  return {
    solutionName,
    testProjectName: solutionName,
    namespace: _namespace,
    rootPath,
    slnPath,
    language: "jmx",
    solutionType: "playwright",
  };
}
