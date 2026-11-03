import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "@/features/projects/infrastructure/projectService";
import * as csharpCodegen from "@/features/codegen/infrastructure/codegen";
import {
  buildUrlEnvVarName,
} from "@/features/codegen/infrastructure/codegenAdapter";
import * as codegenAdapter from "@/features/codegen/infrastructure/codegenAdapter";

/**
 * Persist a named start URL into the project so generated test code
 * can read it back at runtime. Language-specific:
 *   - C#:      `<root>/<testProject>/appsettings.json` Urls map
 *   - Python:  `<root>/.env` (key=value, name from buildUrlEnvVarName)
 *   - Node.js: same .env convention
 */
export async function upsertNamedUrl(
  project: Project,
  urlName: string,
  url: string,
): Promise<void> {
  if (project.language === "csharp" || !project.language) {
    return upsertNamedUrlCsharp(project, urlName, url);
  }
  return upsertNamedUrlDotenv(project, urlName, url);
}

async function upsertNamedUrlCsharp(
  project: Project,
  urlName: string,
  url: string,
): Promise<void> {
  const settingsPath = path.join(
    project.rootPath,
    project.testProjectName,
    "appsettings.json",
  );
  let json: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      json = parsed as Record<string, unknown>;
    }
  } catch {
    // file missing or invalid — start fresh
  }
  const existing = json.Urls;
  const urls: Record<string, string> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, string>) }
      : {};
  urls[urlName] = url;
  json.Urls = urls;
  await fs.writeFile(settingsPath, JSON.stringify(json, null, 2));
  try {
    await csharpCodegen.regenerateTestConfig(project);
  } catch {
    // best-effort sidecar
  }
}

/**
 * Inverse of {@link upsertNamedUrl}: list every named start URL the
 * project already has on disk.
 */
export async function readNamedUrls(
  project: Project,
): Promise<Array<{ name: string; url: string }>> {
  if (project.language === "csharp" || !project.language) {
    return readNamedUrlsCsharp(project);
  }
  return readNamedUrlsDotenv(project);
}

async function readNamedUrlsCsharp(
  project: Project,
): Promise<Array<{ name: string; url: string }>> {
  const settingsPath = path.join(
    project.rootPath,
    project.testProjectName,
    "appsettings.json",
  );
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, "utf8");
  } catch {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];
  const urls = (json as Record<string, unknown>).Urls;
  if (!urls || typeof urls !== "object" || Array.isArray(urls)) return [];
  const out: Array<{ name: string; url: string }> = [];
  for (const [name, value] of Object.entries(urls as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) {
      out.push({ name, url: value });
    }
  }
  return out;
}

async function readNamedUrlsDotenv(
  project: Project,
): Promise<Array<{ name: string; url: string }>> {
  const envPath = path.join(project.rootPath, ".env");
  let raw: string;
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return [];
  }
  const safeSolution = project.solutionName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  const prefix = `${safeSolution}_URL_`;
  const out: Array<{ name: string; url: string }> = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.replace(/^\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).replace(/^\s+/, "");
    if (!line.startsWith(prefix)) continue;
    const eq = line.indexOf("=");
    if (eq <= prefix.length) continue;
    const key = line.slice(0, eq).trimEnd();
    if (!key.startsWith(prefix) || key.length === prefix.length) continue;
    let value = line.slice(eq + 1).replace(/^\s+/, "");
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.indexOf("#");
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trimEnd();
    }
    if (!value) continue;
    out.push({ name: key.slice(prefix.length), url: value });
  }
  return out;
}

async function upsertNamedUrlDotenv(
  project: Project,
  urlName: string,
  url: string,
): Promise<void> {
  const envPath = path.join(project.rootPath, ".env");
  const key = buildUrlEnvVarName(project.solutionName, urlName);
  let lines: string[] = [];
  try {
    const raw = await fs.readFile(envPath, "utf8");
    lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  } catch {
    // file missing — start fresh
  }
  const keyRe = new RegExp(`^${key}=`);
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i]!)) {
      lines[i] = `${key}=${url}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.push(`${key}=${url}`);
  await fs.writeFile(envPath, `${lines.join("\n")}\n`);
  try {
    await codegenAdapter.regenerateTestConfig(project);
  } catch {
    // ignored — sidecar
  }
}
