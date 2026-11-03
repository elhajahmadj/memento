import path from "node:path";
import fs from "node:fs/promises";
import { writeFile } from "./helpers";

/**
 * Emit (or refresh) a tiny `Config` helper class that exposes one typed
 * getter per named URL — backed by the same `application.properties`
 * file the test class would otherwise read directly via ResourceBundle.
 * Returns true when the file was created or rewritten.
 */
export async function upsertJavaConfigClass(
  abs: string,
  pkg: string,
  named: Map<string, string>,
): Promise<boolean> {
  const getters = [...named.entries()]
    .map(([key, _v]) => {
      const pascal = key
        .split(".")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("");
      return `    public String get${pascal}() {\n        return BUNDLE.getString("${key}");\n    }`;
    })
    .join("\n\n");
  const body = `package ${pkg}.config;\n\nimport java.util.ResourceBundle;\n\npublic class Config {\n    private static final ResourceBundle BUNDLE = ResourceBundle.getBundle("application");\n\n${getters}\n}\n`;
  let pre = "";
  try {
    pre = await fs.readFile(abs, "utf8");
  } catch {
    // missing
  }
  if (pre === body) return false;
  await writeFile(abs, body);
  return true;
}

export async function upsertJavaProperties(
  abs: string,
  fallbackUrl: string,
  named: Map<string, string>,
): Promise<boolean> {
  void fallbackUrl;
  let txt = "";
  let pre = false;
  try {
    txt = await fs.readFile(abs, "utf8");
    pre = true;
  } catch {
    // missing
  }
  const lines = txt.length > 0 ? txt.split("\n") : [];
  const present = new Set(
    lines
      .map((l) => l.match(/^([a-zA-Z_][a-zA-Z0-9_.\-]*)\s*=/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => m[1]!),
  );
  let changed = false;
  // Only retain legacy `base.url` if a previous version of the file
  // already declared one — never re-seed it when absent.
  for (const [k, v] of named.entries()) {
    if (present.has(k)) continue;
    lines.push(`${k}=${v}`);
    present.add(k);
    changed = true;
  }
  if (!changed && pre) return false;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const out = lines.join("\n").replace(/\n+$/, "") + "\n";
  await fs.writeFile(abs, out);
  return true;
}
