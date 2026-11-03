import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import {
  type Architecture,
  Language,
  type Language as LanguageType,
  SolutionType,
  type SolutionType as SolutionTypeT,
  useListArchitectures,
  useListRepoPats,
} from "@workspace/api-client-react";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { normalizeJmxTargetUrl } from "./jmx-target-url";
import { usePrewarmBrowser } from "@/features/projects/presentation/hooks/use-prewarm-browser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";

export interface CreateProjectInput {
  solutionName: string;
  testProjectName: string;
  namespace: string;
  architectureId: string;
  language: LanguageType;
  solutionType: SolutionTypeT;
  targetUrl?: string;
  jwtAuth?: boolean;
  bff?: boolean;
}

export type CloneProviderMode = "azure_repos" | "github" | "existing_pat";

export interface CloneProjectInput {
  solutionName: string;
  provider: CloneProviderMode;
  repoUrl: string;
  branch: string;
  pat: string | null;
  repoPatId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateProjectInput) => void;
  creating: boolean;
  onClone?: ((input: CloneProjectInput) => void) | undefined;
  cloning?: boolean | undefined;
  cloneError?: string | null | undefined;
  onClearCloneError?: (() => void) | undefined;
}

function defaultArchIdFor(
  language: LanguageType,
  solutionType: SolutionTypeT,
): string {
  if (solutionType === SolutionType.api) {
    if (language === Language.python) return "api-default-python";
    if (language === Language.nodejs) return "api-default-nodejs";
    if (language === Language.java) return "api-default-java";
    return "api-default-csharp";
  }
  if (language === Language.python) return "python-default";
  if (language === Language.nodejs) return "nodejs-default";
  if (language === Language.java) return "java-default";
  return "default";
}

function defaultArchEntry(
  language: LanguageType,
  solutionType: SolutionTypeT,
) {
  const id = defaultArchIdFor(language, solutionType);
  const isApi = solutionType === SolutionType.api;
  const namesByLang: Record<LanguageType, string> = {
    [Language.csharp]: isApi ? "API Default (C#)" : "Default",
    [Language.python]: isApi ? "API Default (Python)" : "Python Default",
    [Language.nodejs]: isApi ? "API Default (Node.js)" : "Node.js Default",
    [Language.java]: isApi ? "API Default (Java)" : "Java Default",
    [Language.jmx]: "JMX Builder",
  };
  return {
    id,
    name: namesByLang[language],
    isBuiltIn: true,
    projects: [],
    language,
    solutionType,
  };
}

const PLAYWRIGHT_DEFAULT_NAME = "PlaywrightSuite";
const API_DEFAULT_NAME = "AutomationAPI";

function defaultSolutionName(t: SolutionTypeT): string {
  return t === SolutionType.api ? API_DEFAULT_NAME : PLAYWRIGHT_DEFAULT_NAME;
}

const CLONE_PROVIDER_LABEL: Record<CloneProviderMode, string> = {
  azure_repos: "Azure Repos",
  github: "GitHub",
  existing_pat: "Existing Repo PAT",
};

const CLONE_PROVIDER_PLACEHOLDER: Record<"azure_repos" | "github", string> = {
  azure_repos: "https://dev.azure.com/org/project/_git/repo",
  github: "https://github.com/owner/repo.git",
};

// Derive the project folder name from the last meaningful URL segment.
// Matches the convention `git clone <url>` uses locally — strips `.git`
// and any trailing slashes, then replaces characters that aren't legal
// in the server-side `validId` regex with `-`.
export function deriveCloneSolutionName(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  let tail = trimmed.replace(/\/+$/, "");
  // For URLs we only care about the path, not the host.
  const lastSlash = tail.lastIndexOf("/");
  if (lastSlash >= 0) tail = tail.slice(lastSlash + 1);
  tail = tail.replace(/\.git$/i, "");
  // Allowed: starts with a letter, then [A-Za-z0-9_.-]*
  let cleaned = tail.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) return "";
  if (!/^[A-Za-z]/.test(cleaned)) cleaned = `repo-${cleaned}`;
  return cleaned;
}

interface ScaffoldFormProps {
  onCreate: (input: CreateProjectInput) => void;
  creating: boolean;
  architectures: Architecture[] | undefined;
  onCancel: () => void;
  resetSignal: number;
}

function ScaffoldForm({
  onCreate,
  creating,
  architectures,
  onCancel,
  resetSignal,
}: ScaffoldFormProps) {
  const [solutionName, setSolutionName] = useState(PLAYWRIGHT_DEFAULT_NAME);
  const [testProjectName, setTestProjectName] = useState(
    `${PLAYWRIGHT_DEFAULT_NAME}.Tests`,
  );
  const [namespace, setNamespace] = useState(PLAYWRIGHT_DEFAULT_NAME);
  const [language, setLanguage] = useState<LanguageType>(Language.csharp);
  const [solutionType, setSolutionType] = useState<SolutionTypeT>(
    SolutionType.playwright,
  );
  const [architectureId, setArchitectureId] = useState<string>(
    defaultArchIdFor(Language.csharp, SolutionType.playwright),
  );
  const [solutionNameTouched, setSolutionNameTouched] = useState(false);
  const [namespaceTouched, setNamespaceTouched] = useState(false);
  const [testProjectTouched, setTestProjectTouched] = useState(false);

  useEffect(() => {
    setSolutionName(PLAYWRIGHT_DEFAULT_NAME);
    setTestProjectName(`${PLAYWRIGHT_DEFAULT_NAME}.Tests`);
    setNamespace(PLAYWRIGHT_DEFAULT_NAME);
    setLanguage(Language.csharp);
    setSolutionType(SolutionType.playwright);
    setArchitectureId(defaultArchIdFor(Language.csharp, SolutionType.playwright));
    setSolutionNameTouched(false);
    setNamespaceTouched(false);
    setTestProjectTouched(false);
  }, [resetSignal]);

  useEffect(() => {
    if (solutionNameTouched) return;
    const next = defaultSolutionName(solutionType);
    setSolutionName(next);
    if (!namespaceTouched) setNamespace(next);
    if (!testProjectTouched) setTestProjectName(`${next}.Tests`);
  }, [solutionType, solutionNameTouched, namespaceTouched, testProjectTouched]);

  function handleSolutionNameChange(next: string) {
    setSolutionNameTouched(true);
    setSolutionName(next);
    if (!namespaceTouched) setNamespace(next);
    if (!testProjectTouched) setTestProjectName(next ? `${next}.Tests` : "");
  }

  const filteredArchitectures = useMemo(
    () =>
      (architectures ?? []).filter(
        (a) =>
          (a.language ?? Language.csharp) === language &&
          (a.solutionType ?? SolutionType.playwright) === solutionType,
      ),
    [architectures, language, solutionType],
  );

  useEffect(() => {
    const stillValid = filteredArchitectures.some((a) => a.id === architectureId);
    if (!stillValid) setArchitectureId(defaultArchIdFor(language, solutionType));
  }, [language, solutionType, filteredArchitectures, architectureId]);

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Solution type</Label>
            <RadioGroup
              value={solutionType}
              onValueChange={(v) => setSolutionType(v as SolutionTypeT)}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value={SolutionType.playwright}
                  id="solution-type-playwright"
                  data-testid="radio-solution-type-playwright"
                />
                Playwright (UI tests)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value={SolutionType.api}
                  id="solution-type-api"
                  data-testid="radio-solution-type-api"
                />
                API (HTTP-only)
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lang">Language</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as LanguageType)}
            >
              <SelectTrigger id="lang" data-testid="select-language">
                <SelectValue placeholder="C# / .NET" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={Language.csharp} data-testid="option-language-csharp">C# (.NET / NUnit)</SelectItem>
                <SelectItem value={Language.python} data-testid="option-language-python">Python (pytest)</SelectItem>
                <SelectItem value={Language.nodejs} data-testid="option-language-nodejs">Node.js (Playwright Test)</SelectItem>
                <SelectItem value={Language.java} data-testid="option-language-java">Java (JUnit 5 + Playwright)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="sln">Solution name</Label>
            <Input id="sln" value={solutionName} onChange={(e) => handleSolutionNameChange(e.target.value)} data-testid="input-solution-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj">Test project</Label>
            <Input
              id="proj"
              value={testProjectName}
              onChange={(e) => {
                setTestProjectTouched(true);
                setTestProjectName(e.target.value);
              }}
              data-testid="input-test-project"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ns">Namespace</Label>
            <Input
              id="ns"
              value={namespace}
              onChange={(e) => {
                setNamespaceTouched(true);
                setNamespace(e.target.value);
              }}
              data-testid="input-namespace"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="arch">Architecture</Label>
            <Select
              value={architectureId}
              onValueChange={setArchitectureId}
            >
              <SelectTrigger id="arch" data-testid="select-architecture">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                {(filteredArchitectures.length > 0
                  ? filteredArchitectures
                  : [defaultArchEntry(language, solutionType)]
                ).map((a) => (
                  <SelectItem
                    key={a.id}
                    value={a.id}
                    data-testid={`option-architecture-${a.id}`}
                  >
                    {a.name}
                    {a.isBuiltIn ? " (built-in)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => onCreate({
            solutionName,
            testProjectName,
            namespace,
            architectureId,
            language,
            solutionType,
          })}
          disabled={creating}
          data-testid="button-create-project"
        >
          {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}

interface CloneFormProps {
  onClone: (input: CloneProjectInput) => void;
  cloning: boolean;
  open: boolean;
  onCancel: () => void;
  resetSignal: number;
  cloneError: string | null;
  onClearCloneError: () => void;
}

function CloneForm({
  onClone,
  cloning,
  open,
  onCancel,
  resetSignal,
  cloneError,
  onClearCloneError,
}: CloneFormProps) {
  const [provider, setProvider] = useState<CloneProviderMode>("azure_repos");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [pat, setPat] = useState("");
  const [repoPatId, setRepoPatId] = useState("");
  const [solutionName, setSolutionName] = useState("");
  const [solutionNameTouched, setSolutionNameTouched] = useState(false);

  useEffect(() => {
    setProvider("azure_repos");
    setRepoUrl("");
    setBranch("main");
    setPat("");
    setRepoPatId("");
    setSolutionName("");
    setSolutionNameTouched(false);
    onClearCloneError();
  }, [resetSignal, onClearCloneError]);

  // Mirror the URL's tail into the solution-name field until the user
  // edits it. Same convention as `git clone <url>`.
  useEffect(() => {
    if (solutionNameTouched) return;
    setSolutionName(deriveCloneSolutionName(repoUrl));
  }, [repoUrl, solutionNameTouched]);

  const { data: repoPats, isLoading: repoPatsLoading } = useListRepoPats({
    query: { queryKey: ["listRepoPats"], enabled: open && provider === "existing_pat" },
  });

  const canSubmit =
    !!solutionName.trim() &&
    !!repoUrl.trim() &&
    !!branch.trim() &&
    (provider === "existing_pat" ? !!repoPatId : pat.trim().length >= 8);

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="clone-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as CloneProviderMode)}
          >
            <SelectTrigger
              id="clone-provider"
              data-testid="select-clone-provider"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CLONE_PROVIDER_LABEL) as CloneProviderMode[]).map(
                (mode) => (
                  <SelectItem
                    key={mode}
                    value={mode}
                    data-testid={`option-clone-provider-${mode}`}
                  >
                    {CLONE_PROVIDER_LABEL[mode]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {provider === "existing_pat" && (
          <div className="space-y-2">
            <Label htmlFor="clone-repo-pat">Existing Repo PAT</Label>
            {repoPatsLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : !repoPats || repoPats.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No Repo PATs yet.{" "}
                <Link
                  href="/admin#repo-pats"
                  className="underline"
                  data-testid="link-clone-repo-pats-empty"
                >
                  Add one in Source control → Repos PAT
                </Link>
                .
              </div>
            ) : (
              <Select value={repoPatId} onValueChange={setRepoPatId}>
                <SelectTrigger
                  id="clone-repo-pat"
                  data-testid="select-clone-repo-pat"
                >
                  <SelectValue placeholder="Select a Repo PAT" />
                </SelectTrigger>
                <SelectContent>
                  {repoPats.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.provider === "github" ? "GitHub" : "Azure Repos"} -{" "}
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="clone-repo-url">Repository URL</Label>
          <Input
            id="clone-repo-url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder={
              provider === "existing_pat"
                ? CLONE_PROVIDER_PLACEHOLDER.azure_repos
                : CLONE_PROVIDER_PLACEHOLDER[provider]
            }
            data-testid="input-clone-repo-url"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="clone-branch">Branch</Label>
            <Input
              id="clone-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              data-testid="input-clone-branch"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clone-solution-name">Project name</Label>
            <Input
              id="clone-solution-name"
              value={solutionName}
              onChange={(e) => {
                setSolutionNameTouched(true);
                setSolutionName(e.target.value);
              }}
              placeholder="repo-name"
              data-testid="input-clone-solution-name"
            />
          </div>
        </div>
        {provider !== "existing_pat" && (
          <div className="space-y-2">
            <Label htmlFor="clone-pat">Personal Access Token</Label>
            <Input
              id="clone-pat"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              autoComplete="off"
              data-testid="input-clone-pat"
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted at rest. Used by future Pull/Push as well.
            </p>
          </div>
        )}
        {cloneError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="text-clone-error"
          >
            {cloneError}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => {
            onClearCloneError();
            onClone({
              solutionName: solutionName.trim(),
              provider,
              repoUrl: repoUrl.trim(),
              branch: branch.trim(),
              pat: provider === "existing_pat" ? null : pat.trim(),
              repoPatId: provider === "existing_pat" ? repoPatId : null,
            });
          }}
          disabled={cloning || !canSubmit}
          data-testid="button-clone-project"
        >
          {cloning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Clone
        </Button>
      </DialogFooter>
    </>
  );
}

interface JmxBuilderFormProps {
  onCreate: (input: CreateProjectInput) => void;
  creating: boolean;
  onCancel: () => void;
  resetSignal: number;
}

export function JmxBuilderForm({
  onCreate,
  creating,
  onCancel,
  resetSignal,
}: JmxBuilderFormProps) {
  const [solutionName, setSolutionName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [jwtAuth, setJwtAuth] = useState(false);
  const [bff, setBff] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setSolutionName("");
    setTargetUrl("");
    setJwtAuth(false);
    setBff(false);
    setSubmitted(false);
  }, [resetSignal]);

  const nameOk = solutionName.trim().length > 0;
  const normalizedUrl = normalizeJmxTargetUrl(targetUrl);
  const urlOk = normalizedUrl !== null;
  const canSubmit = nameOk && urlOk;

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="jmx-name">Project name</Label>
          <Input
            id="jmx-name"
            value={solutionName}
            onChange={(e) => setSolutionName(e.target.value)}
            placeholder="MyLoadPlan"
            data-testid="input-jmx-name"
          />
          {submitted && !nameOk && (
            <p className="text-xs text-destructive">Project name is required.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="jmx-target-url">Target URL</Label>
          <Input
            id="jmx-target-url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            data-testid="input-jmx-target-url"
          />
          {submitted && !urlOk && (
            <p className="text-xs text-destructive">
              Enter a valid URL or hostname (e.g. www.google.com or
              https://example.com).
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={jwtAuth}
            onChange={(e) => setJwtAuth(e.target.checked)}
            data-testid="checkbox-jmx-jwt-auth"
          />
          Use JWT auth
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bff}
              onChange={(e) => setBff(e.target.checked)}
              data-testid="checkbox-jmx-bff"
            />
            BFF (Backend-for-Frontend) auth
          </label>
          <p className="text-xs text-muted-foreground pl-6">
            Enables BFF-aware OAuth, CSRF, and storageState capture in
            downstream recording features.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => {
            setSubmitted(true);
            if (!canSubmit || normalizedUrl === null) return;
            const name = solutionName.trim();
            onCreate({
              solutionName: name,
              testProjectName: name,
              namespace: name,
              architectureId: defaultArchIdFor(
                Language.jmx,
                SolutionType.playwright,
              ),
              language: Language.jmx,
              solutionType: SolutionType.playwright,
              targetUrl: normalizedUrl,
              jwtAuth,
              bff,
            });
          }}
          disabled={creating}
          data-testid="button-create-jmx-project"
        >
          {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  onClone,
  cloning,
  cloneError,
  onClearCloneError,
}: Props) {
  const clearCloneError = useMemo(
    () => onClearCloneError ?? (() => {}),
    [onClearCloneError],
  );
  const [tab, setTab] = useState<"scaffold" | "clone" | "jmx">("scaffold");
  const [resetSignal, setResetSignal] = useState(0);

  const { data: architectures } = useListArchitectures({
    query: { enabled: open, queryKey: ["listArchitectures"] },
  });

  const prewarmBrowser = usePrewarmBrowser();

  useEffect(() => {
    if (!open) {
      setTab("scaffold");
      setResetSignal((n) => n + 1);
      return;
    }
    // Start warming a recording browser the moment the dialog opens, so
    // it is ready by the time the user finishes the form and reaches the
    // workbench. If they never record, the server's idle timer closes it.
    prewarmBrowser();
  }, [open, prewarmBrowser]);

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Scaffold a new solution from a built-in template, or clone an
            existing Git repo into the workspace.
          </DialogDescription>
        </DialogHeader>
        {onClone ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "scaffold" | "clone" | "jmx")}
          >
            <TabsList>
              <TabsTrigger
                value="scaffold"
                data-testid="tab-new-project-scaffold"
              >
                Scaffold
              </TabsTrigger>
              <TabsTrigger value="clone" data-testid="tab-new-project-clone">
                Clone from repo
              </TabsTrigger>
              <TabsTrigger value="jmx" data-testid="tab-new-project-jmx">
                JMX Builder
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scaffold">
              <ScaffoldForm
                onCreate={onCreate}
                creating={creating}
                architectures={architectures}
                onCancel={close}
                resetSignal={resetSignal}
              />
            </TabsContent>
            <TabsContent value="clone">
              <CloneForm
                onClone={onClone}
                cloning={!!cloning}
                open={open && tab === "clone"}
                onCancel={close}
                resetSignal={resetSignal}
                cloneError={cloneError ?? null}
                onClearCloneError={clearCloneError}
              />
            </TabsContent>
            <TabsContent value="jmx">
              <JmxBuilderForm
                onCreate={onCreate}
                creating={creating}
                onCancel={close}
                resetSignal={resetSignal}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs
            value={tab === "clone" ? "scaffold" : tab}
            onValueChange={(v) => setTab(v as "scaffold" | "jmx")}
          >
            <TabsList>
              <TabsTrigger
                value="scaffold"
                data-testid="tab-new-project-scaffold"
              >
                Scaffold
              </TabsTrigger>
              <TabsTrigger value="jmx" data-testid="tab-new-project-jmx">
                JMX Builder
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scaffold">
              <ScaffoldForm
                onCreate={onCreate}
                creating={creating}
                architectures={architectures}
                onCancel={close}
                resetSignal={resetSignal}
              />
            </TabsContent>
            <TabsContent value="jmx">
              <JmxBuilderForm
                onCreate={onCreate}
                creating={creating}
                onCancel={close}
                resetSignal={resetSignal}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
