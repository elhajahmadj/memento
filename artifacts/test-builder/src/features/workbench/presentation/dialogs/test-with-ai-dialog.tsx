import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import {
  useStartAiAgentRun,
  useDiscoverProjectTests,
  getDiscoverProjectTestsQueryKey,
  type AiAgentRunRequestKind,
  type AiAgentRunRequestLanguage,
  type DiscoveredTestNode,
  type DiscoveredTestFile,
  type TestKind,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { RadioCardGroup } from "@/shared/ui/radio-card-group";
import { Checkbox } from "@/shared/ui/checkbox";

type TargetMode = "new_suite" | "add_method";
type TargetMethod = "test" | "beforeEach" | "oneTimeSetUp";

function flattenFiles(nodes: DiscoveredTestNode[] | undefined): DiscoveredTestFile[] {
  const out: DiscoveredTestFile[] = [];
  function walk(n: DiscoveredTestNode) {
    if (n.type === "file") out.push(n);
    else if (n.type === "folder") n.children?.forEach(walk);
  }
  (nodes ?? []).forEach(walk);
  return out;
}

export function TestWithAiDialog({
  open,
  onOpenChange,
  projectName,
  projectId,
  defaultLanguage,
  defaultKind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectName: string;
  /**
   * URL-encoded slnPath of the loaded project. Required by
   * `GET /api/projects/:projectId/tests` (the route resolves
   * `decodeURIComponent(projectId)` against the workspace root, so the
   * short solution name returns 404). Defaults to
   * `encodeURIComponent(projectName)` for backwards compatibility with
   * tests that only pass the short name.
   */
  projectId?: string;
  defaultLanguage: AiAgentRunRequestLanguage;
  defaultKind?: AiAgentRunRequestKind;
}) {
  const discoveryKey = projectId ?? encodeURIComponent(projectName);
  const [, navigate] = useLocation();
  const [kind, setKind] = useState<AiAgentRunRequestKind>(
    defaultKind ?? "playwright",
  );
  const [suiteName, setSuiteName] = useState("");
  const [methodName, setMethodName] = useState("");
  const [category, setCategory] = useState("");
  const [plan, setPlan] = useState("");
  const [targetMode, setTargetMode] = useState<TargetMode>("new_suite");
  const [existingSuiteFile, setExistingSuiteFile] = useState<string>("");
  const [targetMethod, setTargetMethod] = useState<TargetMethod>("test");
  const [ignore, setIgnore] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");

  function reset() {
    setKind(defaultKind ?? "playwright");
    setSuiteName("");
    setMethodName("");
    setCategory("");
    setPlan("");
    setTargetMode("new_suite");
    setExistingSuiteFile("");
    setTargetMethod("test");
    setIgnore(false);
    setIgnoreReason("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  const { data: tree, isFetched: discoveryFetched } = useDiscoverProjectTests(
    discoveryKey,
    {
      query: {
        enabled: open,
        queryKey: getDiscoverProjectTestsQueryKey(discoveryKey),
        refetchOnWindowFocus: false,
      },
    },
  );

  const allSuiteFiles = useMemo(
    () => flattenFiles(tree?.root?.children),
    [tree],
  );

  // Same path-derived classification rule as the server-side
  // `classifyMethod` fallback, so a fixture file with zero discovered
  // methods (e.g. a C# `[SetUp]`-only base fixture) still gets bucketed
  // into the right kind for the dropdown filter. When the file has at
  // least one classified method we prefer `totals` over the path
  // heuristic.
  const dialogKindToTestKind: Record<AiAgentRunRequestKind, TestKind> = {
    playwright: "e2e",
    api: "api",
    unit: "unit",
  };

  // Project-level fallback for fixture-only files (zero classified
  // methods, e.g. a C# `[SetUp]`-only base fixture). The server can't
  // classify a file with zero methods, but the project's solutionType
  // is a strong default — a Playwright UI scaffold's untagged fixtures
  // are obviously e2e. Mirrors the server's
  // `defaultKindForSolutionType` mapping in the discovery route.
  const projectDefaultKind: TestKind = defaultKind
    ? dialogKindToTestKind[defaultKind]
    : "e2e";

  function fileKind(file: DiscoveredTestFile): TestKind {
    if (file.totals.e2e > 0) return "e2e";
    if (file.totals.api > 0) return "api";
    if (file.totals.unit > 0) return "unit";
    // Fallback for fixture-only files (zero classified methods).
    // Matches the C# project layout conventions the scaffolder emits:
    //   {Sln}.UxTests / {Sln}.UI.Tests / .../e2e/...   → e2e
    //   {Sln}.Automation.API.Tests / .../api/...       → api
    //   {Sln}.UnitTests / .../unit/...                 → unit
    // Generic Node/Python/Java projects use lowercase segment names
    // (`e2e/`, `api/`, `unit/`) which the same checks cover.
    const segments = file.path.toLowerCase().split("/");
    const isApiSeg = (s: string) =>
      s === "api" ||
      s.endsWith(".api.tests") ||
      s.includes(".automation.api.tests");
    const isE2eSeg = (s: string) =>
      s === "e2e" ||
      s.endsWith(".uxtests") ||
      s.endsWith(".ux.tests") ||
      s.endsWith(".ui.tests") ||
      s.endsWith(".uitests");
    const isUnitSeg = (s: string) =>
      s === "unit" ||
      s.endsWith(".unittests") ||
      s.endsWith(".unit.tests");
    if (segments.some(isE2eSeg)) return "e2e";
    if (segments.some(isApiSeg)) return "api";
    if (segments.some(isUnitSeg)) return "unit";
    // Final fallback: trust the project's own default kind, so an
    // untagged `BaseFixture.cs` in a Playwright UI scaffold still shows
    // up in the dropdown when the user picks the Playwright kind.
    return projectDefaultKind;
  }

  const languageMatched = useMemo(
    () => allSuiteFiles.filter((f) => f.language === defaultLanguage),
    [allSuiteFiles, defaultLanguage],
  );

  const suiteFiles = useMemo(() => {
    const want = dialogKindToTestKind[kind];
    const byKind = languageMatched.filter((f) => fileKind(f) === want);
    // Python: a pytest suite is `tests/test_*.py` that actually
    // contains at least one `def test_*`. Filter out `conftest.py`,
    // `__init__.py`, and `tests/constants/*_constants.py` files —
    // they get scanned by the discovery walker (or appear in the tree
    // alongside test files) but they are not suites the user can add
    // a `def test_*` to. The "has at least one method" check
    // (`totals.* > 0`) is the cheapest proxy for "contains a real
    // `def test_*`": the Python parser only counts `def test_*`
    // declarations into `totals`, so a `conftest.py` with fixture
    // helpers, an empty `__init__.py`, or a constants module reports
    // zero methods and gets dropped here.
    if (defaultLanguage === "python") {
      return byKind.filter((f) => {
        const path = f.path;
        const base = path.split("/").pop() ?? "";
        if (base === "conftest.py") return false;
        if (base === "__init__.py") return false;
        if (base.endsWith("_constants.py")) return false;
        if (!base.startsWith("test_") || !base.endsWith(".py")) return false;
        const totals = f.totals.e2e + f.totals.api + f.totals.unit;
        return totals > 0;
      });
    }
    // Node.js: a Playwright spec is `tests/*.spec.ts` (or
    // `*.api.spec.ts` / `*.unit.spec.ts`) that contains at least one
    // discovered `test(...)` call. Filter out page objects
    // (`pages/*Page.ts`), per-suite constants
    // (`tests/constants/*-constants.ts`), and the `tests/config.ts`
    // base-url module — they get scanned by the discovery walker but
    // they are not suites the user can append a `test(...)` to.
    if (defaultLanguage === "nodejs") {
      return byKind.filter((f) => {
        const segments = f.path.split("/");
        const base = segments[segments.length - 1] ?? "";
        if (!base.endsWith(".spec.ts") && !base.endsWith(".spec.tsx")) {
          return false;
        }
        if (segments.includes("pages")) return false;
        if (segments.includes("constants")) return false;
        if (base === "config.ts") return false;
        const totals = f.totals.e2e + f.totals.api + f.totals.unit;
        return totals > 0;
      });
    }
    // Java: a JUnit suite lives at
    // `…/src/test/java/<pkg>/tests/<Pascal>Tests.java` and contains
    // at least one `@Test`-annotated method. Filter out page objects
    // (`…/pages/*.java`), per-suite constants (`…/constants/*.java`),
    // the generated `…/config/Config.java` helper, and anything
    // outside `src/test/java/.../tests/` — they get scanned by the
    // discovery walker but they are not suites the user can append
    // an `@Test` method to. The discovery walker already drops
    // `abstract` classes upstream.
    if (defaultLanguage === "java") {
      return byKind.filter((f) => {
        const segments = f.path.split("/");
        const base = segments[segments.length - 1] ?? "";
        if (!base.endsWith(".java")) return false;
        if (!f.path.includes("/src/test/java/")) return false;
        if (!segments.includes("tests")) return false;
        if (segments.includes("pages")) return false;
        if (segments.includes("constants")) return false;
        if (segments.includes("config")) return false;
        const totals = f.totals.e2e + f.totals.api + f.totals.unit;
        return totals > 0;
      });
    }
    // C#: a real suite is a `*.cs` file under a Tests directory
    // (`{Project}.Tests/Tests/`, or `*.UxTests/`, `*.UI.Tests/`,
    // `*.UnitTests/`, `*.Automation.API.Tests/`) that actually
    // declares at least one classified test method (`totals.* > 0`).
    // Exclude `TestFixture.cs` / `TestFixtureBase.cs` by basename —
    // even when the discovery walker treats them as fixtures
    // (e.g. they carry a `[TestFixture]` attribute on the base
    // class) they are never a valid `add_method` target. Picking
    // one would route the emitter into a partial-class companion
    // of the base type — the AI-authored method would land on
    // `TestFixture.AiMethod.{run}.cs`, not the user's real suite,
    // and look as if a whole new test suite was created instead.
    if (defaultLanguage === "csharp") {
      return byKind.filter((f) => {
        const segments = f.path.split("/");
        const base = segments[segments.length - 1] ?? "";
        if (!base.endsWith(".cs")) return false;
        if (base === "TestFixture.cs" || base === "TestFixtureBase.cs") {
          return false;
        }
        const inTestsDir = segments.some(
          (s) =>
            s === "Tests" ||
            /\.(?:UxTests|UiTests|UI\.Tests|UX\.Tests|UnitTests|Unit\.Tests|Automation\.API\.Tests|Tests)$/i.test(
              s,
            ),
        );
        if (!inTestsDir) return false;
        const totals = f.totals.e2e + f.totals.api + f.totals.unit;
        return totals > 0;
      });
    }
    // For Node.js, restrict the dropdown to real Playwright specs:
    // `tests/*.spec.ts` (incl. `.api.spec.ts` and `.unit.spec.ts`),
    // matching the `nodejsRecorderEmitter` write conventions. Filter
    // out helper files the parser otherwise picks up (e.g.
    // `tests/config.ts`, `tests/constants/*-constants.ts`) — they
    // declare no `test(...)` and an `add_method` run against them
    // would corrupt the file. We compare on the project-relative
    // POSIX path so a Windows-style `\` doesn't slip past.
    if (defaultLanguage === "nodejs") {
      return byKind.filter((f) => {
        const p = String(f.path ?? "").replace(/\\/g, "/");
        if (!/^tests\//.test(p)) return false;
        if (!/\.(spec|api\.spec|unit\.spec)\.ts$/i.test(p)) return false;
        // Belt-and-suspenders: keep `tests/config.ts` and
        // `tests/constants/*-constants.ts` out even if a future
        // parser change starts surfacing them.
        if (p === "tests/config.ts") return false;
        if (/^tests\/constants\/.+-constants\.ts$/i.test(p)) return false;
        return true;
      });
    }
    return byKind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageMatched, kind, defaultLanguage]);

  const startRun = useStartAiAgentRun({
    mutation: {
      onSuccess: (r) => {
        toast.success("AI run started");
        onOpenChange(false);
        navigate(`/workbench/ai-runs/${encodeURIComponent(projectName)}/${r.id}`);
      },
      onError: (e: unknown) =>
        toast.error(`Run failed to start: ${(e as Error).message ?? ""}`),
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPlan(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  // When the user picked an existing suite but discovery no longer
  // lists it (file deleted/renamed since the dropdown was populated),
  // block submit so the run can't fail with the emitter's hard
  // "cannot attach to '…' — file not found" error after it has
  // already been scheduled. We gate on the query lifecycle
  // (`discoveryFetched`) rather than `allSuiteFiles.length > 0` so
  // the "discovery returned empty" case (e.g. the picked file was
  // the only suite and has been deleted) still trips the guard
  // instead of silently letting submit through.
  const existingSuiteMissing =
    targetMode === "add_method" &&
    existingSuiteFile.trim().length > 0 &&
    discoveryFetched &&
    !allSuiteFiles.some((f) => f.path === existingSuiteFile);
  const addMethodReady =
    targetMode === "new_suite" ||
    (existingSuiteFile.trim().length > 0 && !existingSuiteMissing);
  const ignoreReady = !ignore || ignoreReason.trim().length > 0;
  // In add_method mode the user-typed name (methodName) is optional —
  // the runner falls back to deriving Given_When_Then from the plan
  // when the field is blank. New suites still require a file name
  // because the emitter uses it to derive class + page-object names.
  const nameReady =
    targetMode === "add_method" || !!suiteName.trim();
  const canSubmit =
    nameReady &&
    !!plan.trim() &&
    addMethodReady &&
    ignoreReady &&
    !startRun.isPending;

  const kindLabel =
    kind === "playwright" ? "Playwright (UI)" : kind === "api" ? "API" : "Unit";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build with AI — {kindLabel}</DialogTitle>
          <DialogDescription>
            Describe what to test in plain English. The agent will author and
            commit the test files into <code>{projectName}</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1 block text-sm">What should the AI build?</Label>
            <RadioCardGroup
              value={targetMode}
              onValueChange={(v) => setTargetMode(v as TargetMode)}
              columns={2}
              options={[
                {
                  value: "new_suite",
                  id: "ai-target-new",
                  "data-testid": "radio-ai-target-new-suite",
                  label: "New test suite",
                  description: "Brand-new suite file from the plan.",
                },
                {
                  value: "add_method",
                  id: "ai-target-add",
                  "data-testid": "radio-ai-target-add-method",
                  label: "Add method to existing suite",
                  description: "Companion file beside an existing suite.",
                },
              ]}
            />
          </div>

          {targetMode === "add_method" && (
            <div>
              <Label>Existing suite file</Label>
              <Select
                value={existingSuiteFile}
                onValueChange={setExistingSuiteFile}
              >
                <SelectTrigger data-testid="select-ai-existing-suite">
                  <SelectValue
                    placeholder={
                      suiteFiles.length > 0
                        ? "Pick a suite…"
                        : allSuiteFiles.length === 0
                          ? "No suite files discovered"
                          : "No suites match this kind yet — pick New test suite instead."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {suiteFiles.map((f) => (
                    <SelectItem
                      key={f.path}
                      value={f.path}
                      data-testid={`option-ai-existing-suite-${f.path}`}
                    >
                      {f.name}{" "}
                      <span className="text-muted-foreground">
                        — {f.path}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                The new method will be appended to the selected suite
                file. For C#, a partial-class companion is written in
                the same folder. Setup / one-time methods from the
                existing suite stay where they are.
              </p>
              {existingSuiteMissing && (
                <p
                  className="text-xs text-destructive mt-1"
                  data-testid="text-ai-existing-suite-missing"
                >
                  Can't find <code>{existingSuiteFile}</code> in this
                  project anymore — it may have been renamed or
                  deleted. Pick another suite, or switch to{" "}
                  <strong>New test suite</strong>.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Test kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as AiAgentRunRequestKind)}
              >
                <SelectTrigger data-testid="select-ai-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="playwright">Playwright (UI)</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="unit">Unit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetMode === "new_suite" ? (
              <div className="md:col-span-2">
                <Label>Suite / file name</Label>
                <Input
                  value={suiteName}
                  onChange={(e) => setSuiteName(e.target.value)}
                  placeholder="LoginSmoke"
                  data-testid="input-ai-suite-name"
                />
              </div>
            ) : (
              <div className="md:col-span-2">
                <Label>Test method name (optional)</Label>
                <Input
                  value={methodName}
                  onChange={(e) => setMethodName(e.target.value)}
                  placeholder="VerifyDashboardWelcome (leave blank to let AI pick)"
                  data-testid="input-ai-method-name"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank and the AI will derive a
                  Given_When_Then name from your plan.
                </p>
              </div>
            )}
          </div>
          <div>
            <Label className="mb-1 block text-sm">Target method</Label>
            <RadioCardGroup
              value={targetMethod}
              onValueChange={(v) => setTargetMethod(v as TargetMethod)}
              columns={3}
              options={[
                {
                  value: "test",
                  id: "ai-method-test",
                  "data-testid": "radio-ai-method-test",
                  label: "New [Test] method",
                },
                {
                  value: "beforeEach",
                  id: "ai-method-before-each",
                  "data-testid": "radio-ai-method-before-each",
                  label: "[SetUp] SetupAsync hook",
                },
                {
                  value: "oneTimeSetUp",
                  id: "ai-method-one-time-set-up",
                  "data-testid": "radio-ai-method-one-time-set-up",
                  label: "[OneTimeSetUp] OneTimeSetupAsync hook",
                },
              ]}
            />
          </div>
          <div>
            <Label>Category (optional)</Label>
            <Input
              value={targetMethod === "test" ? category : ""}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={
                targetMethod === "test"
                  ? "smoke, regression…"
                  : "Categories only apply to [Test] methods"
              }
              disabled={targetMethod !== "test"}
              data-testid="input-ai-category"
            />
            {targetMethod !== "test" && (
              <p
                className="text-xs text-muted-foreground mt-1"
                data-testid="hint-ai-category-disabled"
              >
                Categories only apply to [Test] methods, not setup hooks.
              </p>
            )}
          </div>
          <div>
            <Label className="flex items-center justify-between">
              <span>Plan</span>
              <label className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                <Upload className="h-3 w-3" />
                Upload .txt/.md
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleFile}
                  className="hidden"
                  data-testid="input-ai-plan-file"
                />
              </label>
            </Label>
            <Textarea
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={
                "1. Open the login page\n2. Sign in as alice\n3. Verify the dashboard shows 'Welcome, Alice'"
              }
              rows={10}
              className="font-mono text-sm"
              data-testid="textarea-ai-plan"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={ignore}
                onCheckedChange={(v) => setIgnore(v === true)}
                data-testid="checkbox-ai-ignore"
              />
              <span>Ignore this test</span>
            </label>
            {ignore && (
              <div>
                <Label htmlFor="ai-ignore-reason">Reason</Label>
                <Input
                  id="ai-ignore-reason"
                  value={ignoreReason}
                  onChange={(e) => setIgnoreReason(e.target.value)}
                  placeholder="Why is this test being ignored?"
                  data-testid="input-ai-ignore-reason"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="button-ai-cancel"
          >
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              // In add_method mode, derive the (server-required)
              // suiteName from the basename of the picked existing
              // file so the runner has a stable handle for catalog +
              // report fields. The emitter ignores this in
              // add_method mode and parses the actual class name out
              // of the picked file.
              const derivedSuiteName =
                targetMode === "add_method"
                  ? (existingSuiteFile
                      .split("/")
                      .pop() ?? "")
                      .replace(/\.[^./]+$/, "")
                  : suiteName.trim();
              startRun.mutate({
                projectName,
                data: {
                  kind,
                  plan,
                  suiteName: derivedSuiteName || "Generated",
                  methodName:
                    targetMode === "add_method"
                      ? methodName.trim() || null
                      : null,
                  category:
                    targetMethod === "test"
                      ? category.trim() || null
                      : null,
                  language: defaultLanguage,
                  targetMode,
                  existingSuiteFile:
                    targetMode === "add_method"
                      ? existingSuiteFile.trim() || null
                      : null,
                  targetMethod,
                  ignore,
                  ignoreReason: ignore ? ignoreReason.trim() : null,
                },
              });
            }}
            data-testid="button-ai-start-run"
          >
            {startRun.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Start AI run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
