import { promises as fs } from "node:fs";
import path from "node:path";

import {
  addTotals,
  bumpTotals,
  classifyMethod,
  emptyTotals,
} from "../domain/classifier";
import type {
  DiscoveredTestFile,
  DiscoveredTestFolder,
  DiscoveredTestMethod,
  DiscoveredTestNode,
  ParsedFile,
  ParsedMethod,
  TestDiscoveryResponse,
  TestLanguage,
} from "../domain/types";
import {
  parseCSharpFile,
  parseCSharpTestCategoriesFile,
} from "./parsers/csharp";
import { parseJavaFile } from "./parsers/java";
import { parseNodeJsFile } from "./parsers/nodejs";
import { parsePythonFile } from "./parsers/python";

/**
 * Directories to ignore when walking a project tree. Build artefacts,
 * VCS metadata, and dependency caches that may contain test-shaped files
 * we don't want to surface (e.g. third-party `node_modules/**\/*.spec.js`).
 */
const IGNORE_DIRS = new Set([
  "bin",
  "obj",
  ".vs",
  ".git",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "target",
  "out",
  "dist",
  "build",
  ".idea",
  ".gradle",
  ".mvn",
]);

interface ParseContext {
  /**
   * Project-wide registry of `{Suite}TestCategories.{Const}` -> string
   * value mappings, built by pre-scanning every `TestCategories/*.cs`
   * file in the project. Lets the C# parser resolve
   * `[Trait("Category", FooTestCategories.Smoke)]` to its declared
   * value (e.g. `"smoke-tests"`) so the classifier can match either
   * the constant name or the resolved value.
   */
  csharpCategoryConstants: Map<string, Map<string, string>>;
}

interface ParsedHandlerResult {
  methods: ParsedMethod[];
  /**
   * True for files that look like a real test fixture even when
   * `methods` is empty. Used so the discovery tree (and the
   * "Add method to existing suite" dropdown) still surfaces base /
   * setup-only C# fixtures. Currently only the C# handler sets this.
   */
  isFixture?: boolean;
}

interface LanguageHandler {
  language: TestLanguage;
  matches(fileName: string): boolean;
  parse(content: string, relPath: string, ctx: ParseContext): ParsedHandlerResult;
}

const HANDLERS: ReadonlyArray<LanguageHandler> = [
  {
    language: "csharp",
    matches: (n) => n.endsWith(".cs"),
    parse: (content, _relPath, ctx) => {
      const { methods, isFixture } = parseCSharpFile(content, {
        resolveCategoryConstant: (className, member) =>
          ctx.csharpCategoryConstants.get(className)?.get(member),
      });
      return { methods, isFixture };
    },
  },
  {
    language: "python",
    matches: (n) =>
      n.endsWith(".py") &&
      (n.startsWith("test_") || n.endsWith("_test.py") || n === "conftest.py"),
    parse: (content, relPath) => {
      // conftest.py rarely defines tests but is harmless to scan.
      const { methods } = parsePythonFile(content);
      return {
        methods: methods.map((m) => ({
          ...m,
          // Python ids are file-scoped (`file.py::Class::method`) — prefix
          // here so the leaf id is a usable pytest node id.
          id: `${relPath}::${m.id}`,
        })),
      };
    },
  },
  {
    language: "nodejs",
    matches: (n) =>
      /\.(spec|test)\.(ts|tsx|js|jsx|mts|cts)$/.test(n) &&
      !n.endsWith(".d.ts"),
    parse: (content, relPath) => {
      const { methods, isFixture } = parseNodeJsFile(content);
      return {
        methods: methods.map((m) => ({
          ...m,
          // Playwright ids are scoped to the file path so the dispatcher
          // can route `--grep` to the right spec file:
          //   `tests/login.spec.ts > Login > happy`
          id: `${relPath} > ${m.id}`,
        })),
        // Surface describe-only suites (zero top-level `test(...)`,
        // but at least one `test(`/`test.describe(` call) as fixtures
        // so the AI Agent "Add method to existing suite" dropdown can
        // still target them. Without this, the empty-methods filter
        // in `parseAllFiles` would drop them.
        isFixture,
      };
    },
  },
  {
    language: "java",
    matches: (n) =>
      n.endsWith(".java") &&
      (n.startsWith("Test") || n.endsWith("Test.java") || n.endsWith("Tests.java") || n.endsWith("IT.java")),
    parse: (content) => ({ methods: parseJavaFile(content).methods }),
  },
];

function pickHandler(fileName: string): LanguageHandler | null {
  for (const h of HANDLERS) {
    if (h.matches(fileName)) return h;
  }
  return null;
}

/**
 * Pre-scan the project tree for `TestCategories/*.cs` companion files
 * and merge their `public const string` declarations into a single
 * project-wide registry. The C# parser uses this to resolve
 * `[Trait("Category", FooTestCategories.Smoke)]` constant references
 * to their actual string value (e.g. `"smoke-tests"`).
 */
async function buildCsharpCategoryConstants(
  rootPath: string,
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for await (const f of walk(rootPath, rootPath)) {
    if (!f.name.endsWith(".cs")) continue;
    const segs = f.relPath.split("/");
    if (!segs.includes("TestCategories")) continue;
    let content: string;
    try {
      content = await fs.readFile(f.absPath, "utf8");
    } catch {
      continue;
    }
    for (const [cls, members] of parseCSharpTestCategoriesFile(content)) {
      let bucket = out.get(cls);
      if (!bucket) {
        bucket = new Map();
        out.set(cls, bucket);
      }
      for (const [k, v] of members) bucket.set(k, v);
    }
  }
  return out;
}

async function* walk(
  rootPath: string,
  current: string,
): AsyncGenerator<{ absPath: string; relPath: string; name: string }> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
      // Skip hidden dirs/files (e.g. `.testbuilder.json`, `.git`).
      if (entry.isDirectory()) continue;
    }
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walk(rootPath, abs);
    } else if (entry.isFile()) {
      const rel = path.relative(rootPath, abs).split(path.sep).join("/");
      yield { absPath: abs, relPath: rel, name: entry.name };
    }
  }
}

async function parseAllFiles(
  rootPath: string,
): Promise<Array<ParsedFile & { isFixture?: boolean }>> {
  const ctx: ParseContext = {
    csharpCategoryConstants: await buildCsharpCategoryConstants(rootPath),
  };
  const out: Array<ParsedFile & { isFixture?: boolean }> = [];
  for await (const f of walk(rootPath, rootPath)) {
    const handler = pickHandler(f.name);
    if (!handler) continue;
    let content: string;
    try {
      content = await fs.readFile(f.absPath, "utf8");
    } catch {
      continue;
    }
    const { methods, isFixture } = handler.parse(content, f.relPath, ctx);
    // Files with no methods are still surfaced when the handler flagged
    // the file as a fixture (today: C# base / setup-only fixtures) so
    // the "Add method to existing suite" dropdown in the AI dialog can
    // pick them as a target. Other empty files are dropped.
    if (methods.length === 0 && !isFixture) continue;
    out.push({
      path: f.relPath,
      language: handler.language,
      methods,
      ...(isFixture !== undefined ? { isFixture } : {}),
    });
  }
  return out;
}

interface FolderBuilder {
  type: "folder";
  name: string;
  path: string;
  totals: ReturnType<typeof emptyTotals>;
  children: Map<string, FolderBuilder | DiscoveredTestFile>;
}

function newFolder(name: string, relPath: string): FolderBuilder {
  return {
    type: "folder",
    name,
    path: relPath,
    totals: emptyTotals(),
    children: new Map(),
  };
}

function finalizeFolder(b: FolderBuilder): DiscoveredTestFolder {
  const children: DiscoveredTestNode[] = [];
  for (const child of b.children.values()) {
    if (child.type === "folder") {
      children.push(finalizeFolder(child));
    } else {
      children.push(child);
    }
  }
  // Folders first, then files; each block alphabetical by name.
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    type: "folder",
    name: b.name,
    path: b.path,
    totals: b.totals,
    children,
  };
}

/**
 * Discover every test in a project root and return the canonical
 * folder/file/method tree with rolled-up totals at every folder level.
 *
 * The walker is regex-based and intentionally tolerant — bad source
 * just yields zero methods for that file rather than throwing.
 */
export async function discoverProjectTests(args: {
  projectName: string;
  slnPath: string;
  rootPath: string;
  /**
   * Project-level default kind, derived from the loaded project's
   * `solutionType` ("playwright" → "e2e", "api" → "api", else "unit").
   * Threaded into `classifyMethod` so untagged tests in scaffolded
   * `{Sln}.Tests/Tests/*.cs` UI projects classify as `e2e` (matching
   * the project's purpose) instead of unconditionally falling to
   * `unit`. The "Build with AI → Add method to existing suite"
   * dropdown filters by kind, so this is what lets the dropdown
   * actually surface suites in real scaffolded projects.
   */
  defaultKind?: import("../domain/types").TestKind;
}): Promise<TestDiscoveryResponse> {
  const files = await parseAllFiles(args.rootPath);

  const root = newFolder(path.basename(args.rootPath), "");
  for (const file of files) {
    const segments = file.path.split("/");
    const fileName = segments.pop()!;
    let cursor = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc === "" ? seg : `${acc}/${seg}`;
      let next = cursor.children.get(seg);
      if (!next || next.type !== "folder") {
        next = newFolder(seg, acc);
        cursor.children.set(seg, next);
      }
      cursor = next;
    }

    const fileTotals = emptyTotals();
    const discoveredMethods: DiscoveredTestMethod[] = file.methods.map((m) => {
      const kind = classifyMethod({
        filePath: file.path,
        tags: m.tags,
        ...(args.defaultKind !== undefined ? { defaultKind: args.defaultKind } : {}),
      });
      bumpTotals(fileTotals, kind);
      return {
        type: "method",
        id: m.id,
        name: m.name,
        kind,
        language: file.language,
      };
    });
    discoveredMethods.sort((a, b) => a.name.localeCompare(b.name));

    const fileNode: DiscoveredTestFile = {
      type: "file",
      name: fileName,
      path: file.path,
      language: file.language,
      totals: fileTotals,
      methods: discoveredMethods,
    };
    cursor.children.set(fileName, fileNode);

    // Roll up totals from this file up to the root.
    addTotals(cursor.totals, fileTotals);
    // Walk back up summing — easier to recompute from root after the
    // fact, but we already lost parent links; do an explicit second
    // pass below instead.
  }

  // Recompute folder totals bottom-up to keep them perfectly consistent
  // even when a folder contains both files and subfolders.
  function recompute(b: FolderBuilder): void {
    b.totals = emptyTotals();
    for (const child of b.children.values()) {
      if (child.type === "folder") {
        recompute(child);
        addTotals(b.totals, child.totals);
      } else {
        addTotals(b.totals, child.totals);
      }
    }
  }
  recompute(root);

  return {
    projectName: args.projectName,
    slnPath: args.slnPath,
    root: finalizeFolder(root),
  };
}
