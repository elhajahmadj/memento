import fs from "node:fs/promises";
import path from "node:path";

/**
 * Read the body of any `[SetUp]` / `[OneTimeSetUp]` (or per-language
 * equivalent) hook in an existing test suite file, returning a
 * human-readable rendering for prompt context.
 *
 * Returns an empty string when the file cannot be read or no setup
 * hook is present — never throws. Caller should label the returned
 * text in its prompt (e.g. "Context — these run before your plan; do
 * not re-emit them, but assume their state").
 */
export async function readSetupChain(opts: {
  projectRoot: string;
  existingSuiteFile: string;
  language: "csharp" | "python" | "nodejs" | "java";
}): Promise<string> {
  const abs = path.join(opts.projectRoot, opts.existingSuiteFile);
  let txt: string;
  try {
    txt = await fs.readFile(abs, "utf8");
  } catch {
    return "";
  }
  const sections: string[] = [];
  switch (opts.language) {
    case "csharp": {
      const setUp = extractCsharpHookBody(txt, "SetUp");
      const oneTime = extractCsharpHookBody(txt, "OneTimeSetUp");
      if (oneTime) sections.push(`[OneTimeSetUp]\n${oneTime}`);
      if (setUp) sections.push(`[SetUp]\n${setUp}`);
      break;
    }
    case "python": {
      const cls = extractPyDefBody(txt, "setup_class");
      const meth = extractPyDefBody(txt, "setup_method");
      if (cls) sections.push(`setup_class:\n${cls}`);
      if (meth) sections.push(`setup_method:\n${meth}`);
      break;
    }
    case "nodejs": {
      const all = extractTsHookBody(txt, "test.beforeAll");
      const each = extractTsHookBody(txt, "test.beforeEach");
      if (all) sections.push(`test.beforeAll:\n${all}`);
      if (each) sections.push(`test.beforeEach:\n${each}`);
      break;
    }
    case "java": {
      const all = extractJavaHookBody(txt, "BeforeAll");
      const each = extractJavaHookBody(txt, "BeforeEach");
      if (all) sections.push(`@BeforeAll\n${all}`);
      if (each) sections.push(`@BeforeEach\n${each}`);
      break;
    }
  }
  return sections.join("\n\n");
}

/**
 * Read the hidden `{TestSuiteName}Setup` sidecar (no extension) that
 * the C# emitter writes next to a suite file whenever the user
 * records a `[SetUp]` / `[OneTimeSetUp]` step via Build with AI. The
 * sidecar holds the user's original plain-English plan text, which
 * later `add_method` runs prepend to the LLM context so the AI
 * doesn't re-emit code for setup that already exists.
 *
 * Returns "" when the sidecar is missing, unreadable, or the
 * language is not csharp. Sidecars are intentionally extensionless
 * so the test-discovery walker (which dispatches by extension) skips
 * them and the project-tree UI never surfaces them.
 */
export async function readAiSetupSidecar(opts: {
  projectRoot: string;
  existingSuiteFile: string;
  language: "csharp" | "python" | "nodejs" | "java";
}): Promise<string> {
  // Python / Node / Java: sidecar lives next to the suite at
  // `{stem}.setup` (e.g. `tests/test_login.py` →
  // `tests/test_login.setup`, `tests/login.spec.ts` →
  // `tests/login.spec.setup`, `.../tests/LoginTests.java` →
  // `.../tests/LoginTests.setup`). The `.setup` extension is excluded
  // from the project file tree.
  if (
    opts.language === "python" ||
    opts.language === "nodejs" ||
    opts.language === "java"
  ) {
    const ext =
      opts.language === "python"
        ? ".py"
        : opts.language === "nodejs"
          ? ".ts"
          : ".java";
    const dir = path.posix.dirname(opts.existingSuiteFile);
    const base = path.posix.basename(opts.existingSuiteFile);
    const stem = base.endsWith(ext) ? base.slice(0, -ext.length) : base;
    const rel = dir === "." ? `${stem}.setup` : `${dir}/${stem}.setup`;
    try {
      const txt = await fs.readFile(path.join(opts.projectRoot, rel), "utf8");
      return txt.trim();
    } catch {
      return "";
    }
  }
  if (opts.language !== "csharp" && opts.language !== "java") return "";
  // The emitter writes the sidecar under the **declared class name**
  // (C#: `{ClassName}Setup` extensionless; Java: `{ClassName}.setup`).
  // When file basename and class name diverge (e.g. `LoginSuite.cs`
  // declaring `class LoginTestSuite`), reading by basename alone
  // would miss the sidecar and the LLM would lose the prior setup
  // intent. So: try the declared class name first (authoritative —
  // same rule the emitter uses), and only fall back to the file
  // basename when the file can't be parsed.
  const dir = path.posix.dirname(opts.existingSuiteFile);
  const candidates: string[] = [];
  if (opts.language === "csharp") {
    const declared = await readCsharpDeclaredClassName(
      opts.projectRoot,
      opts.existingSuiteFile,
    );
    if (declared) candidates.push(`${dir}/${declared}Setup`);
    const stem = csharpClassStemFromPath(opts.existingSuiteFile);
    if (stem && stem !== declared) candidates.push(`${dir}/${stem}Setup`);
  } else {
    // java
    const declared = await readJavaDeclaredClassName(
      opts.projectRoot,
      opts.existingSuiteFile,
    );
    if (declared) candidates.push(`${dir}/${declared}.setup`);
    const base = path.posix.basename(opts.existingSuiteFile);
    const stem = base.endsWith(".java") ? base.slice(0, -5) : "";
    if (stem && stem !== declared) candidates.push(`${dir}/${stem}.setup`);
  }
  for (const rel of candidates) {
    try {
      const txt = await fs.readFile(path.join(opts.projectRoot, rel), "utf8");
      return txt.trim();
    } catch {
      // try next candidate
    }
  }
  return "";
}

async function readJavaDeclaredClassName(
  projectRoot: string,
  existingSuiteFile: string,
): Promise<string | null> {
  try {
    const abs = path.join(projectRoot, existingSuiteFile);
    const txt = await fs.readFile(abs, "utf8");
    const m = txt.match(
      /\b(?:public|protected|private)?\s*(?:final\s+|static\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Strip directory + `.cs` from a relative suite file path. Used as a
 * sidecar lookup fallback when the file can't be read/parsed for a
 * class declaration.
 */
function csharpClassStemFromPath(rel: string): string {
  const base = path.posix.basename(rel);
  return base.endsWith(".cs") ? base.slice(0, -3) : "";
}

/**
 * Mirror of `csharpRecorderEmitter.readExistingClassName` — kept in
 * lock-step so the sidecar reader looks up the same key the emitter
 * writes. Returns null when the file is unreadable or contains no
 * class declaration.
 */
async function readCsharpDeclaredClassName(
  projectRoot: string,
  existingSuiteFile: string,
): Promise<string | null> {
  try {
    const abs = path.join(projectRoot, existingSuiteFile);
    const txt = await fs.readFile(abs, "utf8");
    const m = txt.match(
      /\b(?:public|internal|private|protected)?\s*(?:abstract\s+|sealed\s+|static\s+)?(?:partial\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractCsharpHookBody(src: string, attr: string): string {
  const re = new RegExp(
    `\\[${attr}[^\\]]*\\][\\s\\S]*?(?:public|private|protected|internal)?\\s*(?:async\\s+)?(?:Task|void)\\s+\\w+\\s*\\([^\\)]*\\)`,
    "g",
  );
  const m = re.exec(src);
  if (!m) return "";
  const after = src.slice(m.index + m[0].length);
  return readBracedBody(after);
}

function extractJavaHookBody(src: string, attr: string): string {
  const re = new RegExp(
    `@${attr}[\\s\\S]*?(?:public|private|protected)?\\s*(?:static\\s+)?(?:void|[A-Za-z<>]+)\\s+\\w+\\s*\\([^\\)]*\\)`,
    "g",
  );
  const m = re.exec(src);
  if (!m) return "";
  return readBracedBody(src.slice(m.index + m[0].length));
}

function extractTsHookBody(src: string, hook: string): string {
  const re = new RegExp(
    `${hook.replace(".", "\\.")}\\s*\\(\\s*(?:async\\s*)?\\([^\\)]*\\)\\s*=>\\s*`,
    "g",
  );
  const m = re.exec(src);
  if (!m) return "";
  return readBracedBody(src.slice(m.index + m[0].length));
}

function readBracedBody(s: string): string {
  // Skip whitespace; expect `{`.
  let i = 0;
  while (i < s.length && /\s/.test(s[i]!)) i++;
  if (s[i] !== "{") return "";
  let depth = 0;
  let start = -1;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i).trim();
    }
  }
  return "";
}

function extractPyDefBody(src: string, fnName: string): string {
  const re = new RegExp(
    `^([ \\t]*)def\\s+${fnName}\\s*\\([^\\)]*\\)\\s*(?:->[^:]+)?:\\s*\\n`,
    "m",
  );
  const m = re.exec(src);
  if (!m) return "";
  const baseIndent = m[1] ?? "";
  const lines = src.slice(m.index + m[0].length).split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    const indentMatch = line.match(/^([ \t]*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    if (indent.length <= baseIndent.length) break;
    out.push(line);
  }
  return out.join("\n").trim();
}
